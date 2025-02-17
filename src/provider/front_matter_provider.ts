import { Suggestion, SuggestionContext, SuggestionProvider } from "./provider";
import { CompletrSettings } from "../settings";
import { CachedMetadata, Editor, getAllTags, MetadataCache, TFile } from "obsidian";
import { isInFrontMatterBlock, matchWordBackwards, maybeLowerCase } from "../editor_helpers";

const BASE_SUGGESTION = new Suggestion("front-matter", "---\n~\n---");
const PUBLISH_SUGGESTION = new Suggestion("publish: #", "publish: ~");

interface YAMLKeyInfo {
  key: string;
  isList: boolean;
  completions: Set<string>;
}

class YAMLKeyCache {
  private readonly keyMap = new Map<string, YAMLKeyInfo>();

  addEntry(key: string, value: string) {
    if (!this.keyMap.has(key)) {
      this.keyMap.set(key, { key, isList: false, completions: new Set() });
    }
    this.keyMap.get(key)!.completions.add(value);
  }

  addEntries(key: string, values: string[]) {
    if (!this.keyMap.has(key)) {
      this.keyMap.set(key, { key, isList: false, completions: new Set() });
    }
    const info = this.keyMap.get(key)!;
    info.isList = true;
    for (const v of values) {
      if (!v) continue;
      info.completions.add(v);
    }
  }

  getAllKeys(): YAMLKeyInfo[] {
    return [...this.keyMap.values()];
  }
}

class FrontMatterSuggestionProvider implements SuggestionProvider {
  blocksAllOtherProviders = true;
  private fileSuggestionCache = new Map<string, YAMLKeyCache>();

  getSuggestions(context: SuggestionContext, settings: CompletrSettings): Suggestion[] {
    if (!settings.frontMatterProviderEnabled) return [];

    const editor = context.editor;
    const firstLine = editor.getLine(0);
    const inFrontMatter = isInFrontMatterBlock(editor, context.start);
    const ignoreCase = settings.frontMatterIgnoreCase;

    // 1) Suggest starting front matter if on line 0
    if (!inFrontMatter && context.start.line === 0 && (firstLine === "" || maybeLowerCase("front-matter", ignoreCase).startsWith(maybeLowerCase(firstLine, ignoreCase)))) {
      return [BASE_SUGGESTION];
    } else if (!inFrontMatter) {
      return [];
    }

    // 2) If in front matter already
    const query = maybeLowerCase(context.query, ignoreCase);

    // If at line start, we might be adding a new key
    if (context.start.ch === 0) {
      const suggestions = this.getAllKnownKeys().flatMap((key) => {
        if (!key.isList) {
          return [new Suggestion(`${key.key}: #`, `${key.key}: ~`)];
        }
        return [
          new Suggestion(`${key.key}: [#]`, `${key.key}: [~]`),
          new Suggestion(`${key.key}: \\...`, `${key.key}:\n- ~`),
        ];
      });
      suggestions.push(PUBLISH_SUGGESTION);
      return suggestions.filter((s) => s.getDisplayNameLowerCase(ignoreCase).startsWith(query));
    }

    // 3) Maybe completing a known key's value
    const currentLine = maybeLowerCase(editor.getLine(context.start.line), ignoreCase);
    if (currentLine.startsWith("publish:")) {
      return FrontMatterSuggestionProvider.getPublishSuggestions(query);
    }

    // See if we're inside some known key that's a list or inline
    const possibleKey = this.findKeyInfo(editor, context.start.line, currentLine, ignoreCase);
    if (!possibleKey) return [];

    // Gather the partial typed "word" => e.g. "tagprefix" ignoring slash/dash
    const { query: customQuery } = matchWordBackwards(
      editor,
      context.end,
      (char) => new RegExp(`[${settings.characterRegex}/\\-_]`).test(char),
      settings.maxLookBackDistance
    );

    // Possibly add comma or newline after the chosen tag
    let replacementSuffix = "";
    if (settings.frontMatterTagAppendSuffix && possibleKey.isList) {
      // If inline
      if (currentLine.trimStart().startsWith(`${possibleKey.key}: [`)) {
        replacementSuffix = ", ";
      } else {
        // For multiline list
        const line = editor.getLine(context.start.line);
        const indentation = line.match(/^\s*/)?.[0] ?? "";
        replacementSuffix = `\n${indentation}- `;
      }
    }

    return [...possibleKey.completions]
      .filter((tag) => maybeLowerCase(tag, ignoreCase).startsWith(maybeLowerCase(customQuery, ignoreCase)))
      .map((tag) => {
        return new Suggestion(tag, tag + replacementSuffix, {
          ...context.end,
          ch: context.end.ch - customQuery.length,
        });
      })
      .sort((a, b) => a.displayName.length - b.displayName.length);
  }

  private findKeyInfo(editor: Editor, lineIndex: number, currentLine: string, ignoreCase: boolean) {
    // If the user typed "key: something" or in multiline list for "key:"
    for (const info of this.getAllKnownKeys()) {
      const keyLower = maybeLowerCase(info.key, ignoreCase);

      // Inline
      if (currentLine.startsWith(`${keyLower}: `)) {
        return info;
      }

      // Multi-line check (like `key:\n- item`)
      if (currentLine.trimStart().startsWith("- ") && info.isList) {
        // Search upward for the "key:" line
        let found = false;
        for (let i = lineIndex - 1; i >= 1; i--) {
          const line = maybeLowerCase(editor.getLine(i).trim(), ignoreCase);
          if (line.endsWith(":")) {
            // e.g. "tags:"
            found = line.startsWith(`${keyLower}:`);
            break;
          }
        }
        if (found) return info;
      }
    }
    return null;
  }

  private static getPublishSuggestions(query: string) {
    const possibilities = [Suggestion.fromString("true"), Suggestion.fromString("false")];
    const partial = possibilities.filter((s) => s.displayName.startsWith(query) && s.displayName !== query);
    if (partial.length > 0) return partial;
    if (query === "true" || query === "false") {
      return query === "true" ? possibilities.reverse() : possibilities;
    }
    return [];
  }

  onCacheChange = (file: TFile, _data: string, cache: CachedMetadata) => {
    // Rebuild the YAML key completions
    this.addKeyCompletionsFromFile(file, cache);
  };

  loadYAMLKeyCompletions(cache: MetadataCache, files: TFile[]) {
    for (const file of files) {
      const fileCache = cache.getFileCache(file);
      if (fileCache) {
        this.addKeyCompletionsFromFile(file, fileCache);
      }
    }
  }

  private addKeyCompletionsFromFile(file: TFile, cache: CachedMetadata) {
    if (!file || !cache || !cache.frontmatter) return;

    const keyCache = new YAMLKeyCache();
    this.fileSuggestionCache.set(file.path, keyCache);

    for (const key of Object.keys(cache.frontmatter)) {
      if (["position", "publish", "tags"].includes(key)) continue;
      const val = cache.frontmatter[key];
      if (!val) continue;
      if (Array.isArray(val)) {
        keyCache.addEntries(key, val);
      } else {
        keyCache.addEntry(key, val.toString());
      }
    }

    // Gather tags (by Obsidian's getAllTags)
    const tags = getAllTags(cache);
    if (tags && tags.length > 0) {
      keyCache.addEntries("tags", tags.map((t) => t.substring(1)));
    }
  }

  private getAllKnownKeys(): YAMLKeyInfo[] {
    const combined = new Map<string, YAMLKeyInfo>();
    for (const cache of this.fileSuggestionCache.values()) {
      for (const info of cache.getAllKeys()) {
        if (!combined.has(info.key)) {
          combined.set(info.key, { key: info.key, isList: false, completions: new Set() });
        }
        const existing = combined.get(info.key)!;
        info.completions.forEach((c) => existing.completions.add(c));
        existing.isList = existing.isList || info.isList;
      }
    }
    return [...combined.values()];
  }
}

export const FrontMatter = new FrontMatterSuggestionProvider();
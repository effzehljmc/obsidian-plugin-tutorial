import { getApi } from "obsidian-callout-manager";
import { Notice, Plugin as ObsidianPlugin, Vault } from "obsidian";
import { Suggestion, SuggestionContext, SuggestionProvider } from "./provider";
import { CalloutProviderSource, CompletrSettings, intoCompletrPath } from "../settings";
import { SuggestionBlacklist } from "./blacklist";
import MyAutoCompletionPlugin from "../main";

const CALLOUT_SUGGESTIONS_FILE = "callout_suggestions.json";

/**
 * Provides completions for `[!info]`, `[!warning]`, etc., either from the local JSON or from Callout Manager plugin.
 */
class CalloutSuggestionProvider implements SuggestionProvider {
  blocksAllOtherProviders = true;
  private loadedSuggestions: Suggestion[] = [];

  async loadSuggestions(vault: Vault, plugin: any) {
    if (!(plugin instanceof MyAutoCompletionPlugin)) return;
    
    const source = plugin.settings.calloutProviderSource;
    const calloutManagerApi = await getApi(plugin as any);
    if (calloutManagerApi) {
      calloutManagerApi.off("change", this.reloadFromCalloutManager);
      if (source === CalloutProviderSource.CALLOUT_MANAGER) {
        calloutManagerApi.on("change", this.reloadFromCalloutManager);
        await this.reloadFromCalloutManager();
        return;
      }
    }
    // Otherwise fallback to local file
    await this.loadFromCompletrJson(vault);
  }

  private reloadFromCalloutManager = async () => {
    const api = await getApi();
    if (!api) return;
    this.loadedSuggestions = Array.from(api.getCallouts())
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((callout) => {
        return new Suggestion(api.getTitle(callout), callout.id, undefined, undefined, {
          icon: callout.icon,
          color: `rgb(${callout.color})`,
        });
      });
  };

  private async loadFromCompletrJson(vault: Vault) {
    const path = intoCompletrPath(vault, CALLOUT_SUGGESTIONS_FILE);
    if (!(await vault.adapter.exists(path))) {
      // If not present, write defaults
      const defaults = generateDefaultCallouts();
      await vault.adapter.write(path, JSON.stringify(defaults, null, 2));
      this.loadedSuggestions = defaults;
    } else {
      try {
        const content = await vault.adapter.read(path);
        const arr = JSON.parse(content);
        this.loadedSuggestions = arr.map((obj: any) => {
          if (typeof obj === "string") {
            return Suggestion.fromString(obj);
          }
          return new Suggestion(obj.displayName, obj.replacement, undefined, undefined, {
            icon: obj.icon,
            color: obj.color,
          });
        });
      } catch (e: any) {
        new Notice("Failed to parse callout_suggestions.json. Using defaults.");
        this.loadedSuggestions = generateDefaultCallouts();
      }
    }
    this.loadedSuggestions = SuggestionBlacklist.filter(this.loadedSuggestions);
  }

  getSuggestions(context: SuggestionContext, settings: CompletrSettings): Suggestion[] {
    if (!settings.calloutProviderEnabled) return [];
    const { editor } = context;
    const lineNumber = context.start.line;
    const line = editor.getLine(lineNumber);

    // Must be block quote lines that start a new callout
    const quote = extractBlockQuotePrefix(line);
    if (!quote) return [];
    const quoteAbove =
      lineNumber === 0 ? null : extractBlockQuotePrefix(editor.getLine(lineNumber - 1));
    if (quoteAbove && quoteAbove.depth >= quote.depth) return [];

    // Now parse the callout header
    const callout = extractCalloutHeader(line.substring(quote.chOffset));
    if (!callout) return [];

    // If the cursor is not inside the "type" portion, no suggestions
    const cursor = editor.getCursor("from").ch - quote.chOffset;
    const calloutType = callout.type;
    const typeTextEnd = calloutType.end - (calloutType.rawText.endsWith("]") ? 1 : 0);
    if (cursor < calloutType.start + 1 || cursor > typeTextEnd) return [];

    // Filter known suggestions by typed prefix
    const typedSoFar = calloutType.text.toLowerCase().substring(
      0,
      cursor - (calloutType.rawText.indexOf(calloutType.text) + calloutType.start)
    );

    const results = this.loadedSuggestions.filter(
      (s) =>
        s.displayName.toLowerCase().startsWith(typedSoFar) ||
        s.replacement.toLowerCase().startsWith(typedSoFar)
    );

    // Replace the entire callout bracket
    const newTitle = callout.title.rawText;
    const newFold = untrimEnd(callout.foldable.rawText);

    return results.map((r) => {
      return r.derive({
        replacement: `[!${r.replacement}]${newFold}${newTitle}`,
        overrideEnd: { line: context.end.line, ch: line.length },
        overrideStart: { line: context.start.line, ch: quote.chOffset },
      });
    });
  }
}

function untrimEnd(str: string) {
  if (str.trimEnd() !== str) return str;
  return str + " ";
}

function extractBlockQuotePrefix(line: string): { depth: number; chOffset: number } | null {
  const match = /^(?:[ \t]*>[ \t]*)+/.exec(line);
  if (!match) return null;
  const text = match[0];
  const depth = text.length - text.replaceAll(">", "").length;
  return { depth, chOffset: text.length };
}

interface CalloutHeader {
  type: { start: number; end: number; text: string; rawText: string };
  foldable: { start: number; end: number; text: string; rawText: string };
  title: { start: number; end: number; text: string; rawText: string };
}

interface RegExpIndices extends RegExpExecArray {
  indices: [number, number][];
}

function extractCalloutHeader(line: string): CalloutHeader | null {
  const CALLOUT_HEADER_REGEX = /^(\[!?([^\]]*)\])([+-]?)([ \t]*)(.*)$/d;
  const CALLOUT_HEADER_PARTIAL_REGEX = /^(\[!?([^\]]*))$/d;

  const result: CalloutHeader = {
    type: { start: -1, end: -1, text: "", rawText: "" },
    foldable: { start: -1, end: -1, text: "", rawText: "" },
    title: { start: -1, end: -1, text: "", rawText: "" },
  };

  let match = CALLOUT_HEADER_REGEX.exec(line) as RegExpIndices | null;
  if (match?.indices) {
    const indices = match.indices;
    [result.type.start, result.type.end] = indices[1];
    result.type.rawText = match[1];
    result.type.text = match[2].trim();

    [result.foldable.start, result.foldable.end] = indices[3];
    result.foldable.rawText = match[3] + match[4];
    result.foldable.text = result.foldable.rawText.trim();

    [result.title.start, result.title.end] = indices[5];
    result.title.rawText = match[5];
    result.title.text = match[5].trim();
    return result;
  }

  match = CALLOUT_HEADER_PARTIAL_REGEX.exec(line) as RegExpIndices | null;
  if (match?.indices) {
    const indices = match.indices;
    [result.type.start, result.type.end] = indices[1];
    result.type.rawText = match[1];
    result.type.text = match[2].trim();
    return result;
  }

  return null;
}

function generateDefaultCallouts(): Suggestion[] {
  // Some default sets: info, warning, success, quote, etc.
  return [
    new Suggestion("Note", "note", undefined, undefined, { icon: "lucide-pencil", color: "#448aff" }),
    new Suggestion("Info", "info", undefined, undefined, { icon: "lucide-info", color: "#00b8d4" }),
    new Suggestion("Tip", "tip", undefined, undefined, { icon: "lucide-flame", color: "#00bfa6" }),
    new Suggestion("Warning", "warning", undefined, undefined, {
      icon: "lucide-alert-triangle",
      color: "#ff9100",
    }),
    new Suggestion("Danger", "danger", undefined, undefined, { icon: "lucide-zap", color: "#ff1744" }),
    new Suggestion("Bug", "bug", undefined, undefined, { icon: "lucide-bug", color: "#f50057" }),
    new Suggestion("Quote", "quote", undefined, undefined, { icon: "quote-glyph", color: "#9e9e9e" }),
  ];
}

export const Callout = new CalloutSuggestionProvider();
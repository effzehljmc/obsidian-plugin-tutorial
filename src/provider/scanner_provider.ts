import { TFile, Vault } from "obsidian";
import { CompletrSettings, intoCompletrPath } from "../settings";
import { DictionaryProvider } from "./dictionary_provider";
import { SuggestionBlacklist } from "./blacklist";

const SCANNED_WORDS_PATH = "scanned_words.txt";
const NEW_LINE_REGEX = /\r?\n/;

class ScannerSuggestionProvider extends DictionaryProvider {
  readonly wordMap: Map<string, Set<string>> = new Map();

  isEnabled(settings: CompletrSettings): boolean {
    return settings.fileScannerProviderEnabled;
  }

  async scanFiles(settings: CompletrSettings, files: TFile[]) {
    for (const file of files) {
      await this.scanFile(settings, file, false);
    }
    await this.saveData(files[0].vault);
  }

  async scanFile(settings: CompletrSettings, file: TFile, saveImmediately: boolean) {
    const contents = await file.vault.cachedRead(file);

    // Exclude math code, code blocks, links, etc.
    const regex = new RegExp(
      "\\$+.*?\\$+|`+.*?`+|\\[+.*?\\]+|https?:\\/\\/[^\\n\\s]+|([" + settings.characterRegex + "]+)",
      "gsu"
    );
    for (const match of contents.matchAll(regex)) {
      const group = match[1];
      if (!group || group.length < settings.minWordLength) continue;
      this.addWord(group);
    }

    if (saveImmediately) await this.saveData(file.vault);
  }

  private addWord(word: string) {
    if (!word || SuggestionBlacklist.hasText(word)) return;

    const first = word.charAt(0);
    if (!this.wordMap.has(first)) {
      this.wordMap.set(first, new Set());
    }
    this.wordMap.get(first)!.add(word);
  }

  async saveData(vault: Vault) {
    let output: string[] = [];
    for (const [_, setOfWords] of this.wordMap.entries()) {
      output.push(...setOfWords);
    }
    const path = intoCompletrPath(vault, SCANNED_WORDS_PATH);
    await vault.adapter.write(path, output.join("\n"));
  }

  async loadData(vault: Vault) {
    const path = intoCompletrPath(vault, SCANNED_WORDS_PATH);
    if (!(await vault.adapter.exists(path))) return;

    const contents = (await vault.adapter.read(path)).split(NEW_LINE_REGEX);
    for (const word of contents) {
      this.addWord(word);
    }
  }

  async deleteAllWords(vault: Vault) {
    this.wordMap.clear();
    await this.saveData(vault);
  }
}

export const FileScanner = new ScannerSuggestionProvider();
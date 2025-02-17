import { CompletrSettings, intoCompletrPath } from "../settings";
import { DictionaryProvider } from "./dictionary_provider";
import { Vault } from "obsidian";
import { SuggestionBlacklist } from "./blacklist";

const WORD_LISTS_FOLDER_PATH = "wordLists";
const NEW_LINE_REGEX = /\r?\n/;

class WordListSuggestionProvider extends DictionaryProvider {
  readonly wordMap: Map<string, string[]> = new Map();

  isEnabled(settings: CompletrSettings): boolean {
    return settings.wordListProviderEnabled;
  }

  async loadFromFiles(vault: Vault, settings: CompletrSettings): Promise<number> {
    this.wordMap.clear();
    const fileNames = await this.getRelativeFilePaths(vault);

    for (const fileName of fileNames) {
      let data: string;
      try {
        data = await vault.adapter.read(fileName);
      } catch (e) {
        console.log("[WordList] Unable to read " + fileName);
        continue;
      }

      const lines = data.split(NEW_LINE_REGEX);
      for (const line of lines) {
        if (!line || line.length < settings.minWordLength) continue;
        const key = line.charAt(0);
        if (!this.wordMap.has(key)) {
          this.wordMap.set(key, []);
        }
        this.wordMap.get(key)!.push(line.trim());
      }
    }

    // Filter & sort
    let total = 0;
    for (const [k, arr] of this.wordMap.entries()) {
      const filtered = SuggestionBlacklist.filterText(arr.sort((a, b) => a.length - b.length));
      this.wordMap.set(k, filtered);
      total += filtered.length;
    }
    return total;
  }

  async deleteWordList(vault: Vault, path: string) {
    await vault.adapter.remove(path);
  }

  async importWordList(vault: Vault, name: string, text: string): Promise<boolean> {
    const path = intoCompletrPath(vault, WORD_LISTS_FOLDER_PATH, name);
    if (await vault.adapter.exists(path)) return false;
    await vault.adapter.write(path, text);
    return true;
  }

  async getRelativeFilePaths(vault: Vault): Promise<string[]> {
    const basePath = intoCompletrPath(vault, WORD_LISTS_FOLDER_PATH);
    if (!(await vault.adapter.exists(basePath))) {
      await vault.adapter.mkdir(basePath);
    }
    // Return all files in that folder
    const { files } = await vault.adapter.list(basePath);
    return files;
  }
}

export const WordList = new WordListSuggestionProvider();
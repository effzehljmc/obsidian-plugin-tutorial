import { MyAutoCompletionSettings, WordInsertionMode } from "../settings";
import { Suggestion, SuggestionContext, SuggestionProvider } from "./provider";
import { maybeLowerCase } from "../editor_helpers";

export abstract class DictionaryProvider implements SuggestionProvider {
  abstract readonly wordMap: Map<string, Iterable<string>>;

  abstract isEnabled(settings: MyAutoCompletionSettings): boolean;

  getSuggestions(context: SuggestionContext, settings: MyAutoCompletionSettings): Suggestion[] {
    if (!this.isEnabled(settings) || !context.query || context.query.length < settings.minWordTriggerLength) {
      return [];
    }
    const ignoreCase = settings.wordInsertionMode != WordInsertionMode.MATCH_CASE_REPLACE;

    let query = maybeLowerCase(context.query, ignoreCase);
    if (settings.ignoreDiacriticsWhenFiltering) {
      query = removeDiacritics(query);
    }

    const firstChar = query.charAt(0);
    const result: Suggestion[] = [];

    // Possibly gather from multiple map entries
    const listsToCheck = ignoreCase
      ? [
          this.wordMap.get(firstChar) ?? [],
          this.wordMap.get(firstChar.toUpperCase()) ?? [],
        ]
      : [this.wordMap.get(firstChar) ?? []];

    // Additional diacritic loop
    if (settings.ignoreDiacriticsWhenFiltering) {
      for (let [key, value] of this.wordMap.entries()) {
        const keyFirstChar = maybeLowerCase(key.charAt(0), ignoreCase);
        if (removeDiacritics(keyFirstChar) === firstChar) {
          listsToCheck.push(value);
        }
      }
    }

    for (let iterable of listsToCheck) {
      filterMapIntoArray(
        result,
        iterable,
        (s) => {
          let match = maybeLowerCase(s, ignoreCase);
          if (settings.ignoreDiacriticsWhenFiltering) match = removeDiacritics(match);
          return match.startsWith(query);
        },
        (s) => {
          if (settings.wordInsertionMode === WordInsertionMode.APPEND) {
            // In "append" mode, we keep the typed portion as-is and just append what's left
            return Suggestion.fromString(context.query + s.substring(query.length));
          } else {
            return Suggestion.fromString(s);
          }
        }
      );
    }

    // Sort by length
    return result.sort((a, b) => a.displayName.length - b.displayName.length);
  }
}

const DIACRITICS_REGEX = /[\u0300-\u036f]/g;
function removeDiacritics(str: string): string {
  return str.normalize("NFD").replace(DIACRITICS_REGEX, "");
}

function filterMapIntoArray<T, U>(
  array: T[],
  iterable: Iterable<U>,
  predicate: (val: U) => boolean,
  mapFn: (val: U) => T
) {
  for (const val of iterable) {
    if (!predicate(val)) continue;
    array.push(mapFn(val));
  }
}
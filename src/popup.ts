import { App, Editor, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile, setIcon, EditorPosition, MarkdownView } from "obsidian";
import { Suggestion, SuggestionContext, SuggestionProvider } from "./provider/provider";
import { MyAutoCompletionSettings } from "./settings";
import SnippetManager from "./snippet_manager";
import { FileScanner } from "./provider/scanner_provider";
import { WordList } from "./provider/word_list_provider";
import { Latex } from "./provider/latex_provider";
import { Callout } from "./provider/callout_provider";
import { FrontMatter } from "./provider/front_matter_provider";
import { matchWordBackwards } from "./editor_helpers";

export enum SelectionDirection {
  NEXT,
  PREVIOUS
}

export default class SuggestionPopup extends EditorSuggest<Suggestion> {
  private suggestions: Suggestion[] = [];
  private selectedIndex = 0;
  public lastCursorLine = -1;
  private shouldPreventNextTrigger = false;
  private app: App;

  constructor(
    app: App,
    private settings: MyAutoCompletionSettings,
    private snippetManager: SnippetManager
  ) {
    super(app);
    this.app = app;
    this.handleDocChange = this.handleDocChange.bind(this);
  }

  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
    const end = cursor;
    const line = editor.getLine(cursor.line);
    const start = {
      line: cursor.line,
      ch: Math.max(0, cursor.ch - this.settings.maxLookBackDistance)
    };
    const query = editor.getRange(start, end);

    return {
      start,
      end,
      query
    };
  }

  getSuggestions(context: EditorSuggestContext): Suggestion[] {
    const { editor } = context;
    const cursor = editor.getCursor();

    // Get the word before the cursor
    const { query, separatorChar } = matchWordBackwards(
      editor,
      cursor,
      (char) => new RegExp(`[${this.settings.characterRegex}]`).test(char),
      this.settings.maxLookBackDistance
    );

    console.log("[MyAutoCompletion] Getting suggestions for query:", query, "separator:", separatorChar);

    const suggestionContext: SuggestionContext = {
      ...context,
      query: query ?? "",
      separatorChar: separatorChar ?? ""
    };

    // Gather suggestions from all providers
    let allSuggestions: Suggestion[] = [];
    const providers = [FileScanner, WordList, Latex, Callout, FrontMatter] as SuggestionProvider[];

    for (const provider of providers) {
      try {
        if (!provider.isEnabled?.(this.settings)) {
          console.log("[MyAutoCompletion] Provider disabled:", provider.constructor.name);
          continue;
        }
        const suggestions = provider.getSuggestions(suggestionContext, this.settings);
        console.log("[MyAutoCompletion] Provider", provider.constructor.name, "returned", suggestions.length, "suggestions");
        if (suggestions.length > 0) {
          if (provider.blocksAllOtherProviders) {
            allSuggestions = suggestions;
            break;
          }
          allSuggestions.push(...suggestions);
        }
      } catch (e) {
        console.error("[MyAutoCompletion] Error getting suggestions from provider:", provider.constructor.name, e);
      }
    }

    this.suggestions = allSuggestions;
    console.log("[MyAutoCompletion] Total suggestions:", allSuggestions.length);
    return allSuggestions;
  }

  selectSuggestion(suggestion: Suggestion, evt: MouseEvent | KeyboardEvent): void {
    if (!suggestion) return;

    const editor = this.context?.editor;
    if (!editor) return;

    const cursor = editor.getCursor();

    // Calculate replacement range
    const from = suggestion.overrideStart ?? {
      line: cursor.line,
      ch: cursor.ch - (this.context?.query?.length ?? 0)
    };
    const to = suggestion.overrideEnd ?? cursor;

    // Replace the text
    editor.replaceRange(suggestion.replacement, from, to);

    // Move cursor to end of inserted text
    const cursorOffset = suggestion.replacement.length - (to.ch - from.ch);
    editor.setCursor({ line: cursor.line, ch: cursor.ch + cursorOffset });
  }

  renderSuggestion(suggestion: Suggestion, el: HTMLElement): void {
    const div = el.createDiv({ cls: "completr-suggestion-item" });
    
    if (suggestion.icon) {
      const icon = div.createDiv({ cls: "completr-suggestion-icon" });
      icon.style.setProperty("--completr-suggestion-color", suggestion.color ?? "var(--text-normal)");
      setIcon(icon, suggestion.icon);
    }
    
    div.createSpan({ text: suggestion.displayName });
  }

  isVisible(): boolean {
    return Boolean(this.open);
  }

  handleDocChange(): void {
    console.log("[MyAutoCompletion] handleDocChange called");
    if (this.settings.autoTrigger) {
      console.log("[MyAutoCompletion] autoTrigger is enabled");
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView?.editor) {
        console.log("[MyAutoCompletion] Found active editor, triggering suggestions");
        // Always force trigger on document change
        this.trigger(activeView.editor, activeView.file, true);
      } else {
        console.log("[MyAutoCompletion] No active editor found");
      }
    } else {
      console.log("[MyAutoCompletion] Not triggering - autoTrigger disabled");
    }
  }

  trigger(editor: Editor, file: TFile | null, force: boolean = false): EditorSuggestTriggerInfo | null {
    console.log("[MyAutoCompletion] trigger called - force:", force);

    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);

    // Get the word before the cursor
    const { query, separatorChar } = matchWordBackwards(
      editor,
      cursor,
      (char) => new RegExp(`[${this.settings.characterRegex}]`).test(char),
      this.settings.maxLookBackDistance
    );

    console.log("[MyAutoCompletion] Current query:", query, "separator:", separatorChar);

    // Don't trigger if:
    // 1. No query and not forced
    // 2. Query too short and not forced
    // 3. Auto-trigger disabled and not forced
    if (!force) {
      if (!query) {
        console.log("[MyAutoCompletion] Not triggering - no query");
        return null;
      }
      if (query.length < this.settings.minWordTriggerLength) {
        console.log("[MyAutoCompletion] Not triggering - query too short:", query.length);
        return null;
      }
      if (!this.settings.autoTrigger) {
        console.log("[MyAutoCompletion] Not triggering - autoTrigger disabled");
        return null;
      }
    }

    const start = {
      line: cursor.line,
      ch: Math.max(0, cursor.ch - (query ? query.length : 0))
    };

    console.log("[MyAutoCompletion] Triggering with query:", query);
    return {
      start,
      end: cursor,
      query: query || ""
    };
  }

  selectNextItem(direction: SelectionDirection): void {
    if (!this.open || this.suggestions.length === 0) return;

    this.selectedIndex = (this.selectedIndex + (direction === SelectionDirection.NEXT ? 1 : -1)) % this.suggestions.length;
    if (this.selectedIndex < 0) this.selectedIndex = this.suggestions.length - 1;

    // Update the selected item in the UI
    const items = document.querySelectorAll(".suggestion-item");
    if (!items) return;

    items.forEach((item: Element, index: number) => {
      if (index === this.selectedIndex) {
        item.classList.add("is-selected");
      } else {
        item.classList.remove("is-selected");
      }
    });
  }

  getSelectedItem(): Suggestion {
    return this.suggestions[this.selectedIndex];
  }

  applySelectedItem(): void {
    const selected = this.getSelectedItem();
    if (selected) {
      this.selectSuggestion(selected, new KeyboardEvent("keydown"));
    }
  }

  postApplySelectedItem(editor: Editor): void {
    // Add space after completion if enabled
    if (this.settings.insertSpaceAfterComplete) {
      const cursor = editor.getCursor();
      editor.replaceRange(" ", cursor);
      editor.setCursor(cursor.line, cursor.ch + 1);
    }
  }

  preventNextTrigger(): void {
    this.shouldPreventNextTrigger = true;
  }

  close(): void {
    super.close();
  }
} 
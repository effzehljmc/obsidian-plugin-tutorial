import { Plugin as ObsidianPlugin, TFile, MarkdownView, Command } from "obsidian";
import SuggestionPopup, { SelectionDirection } from "./popup";
import SnippetManager from "./snippet_manager";
import PeriodInserter from "./period_inserter";
import { FileScanner } from "./provider/scanner_provider";
import { WordList } from "./provider/word_list_provider";
import { Latex } from "./provider/latex_provider";
import { Callout } from "./provider/callout_provider";
import { SuggestionBlacklist } from "./provider/blacklist";
import CompletrSettingsTab from "./settings_tab";
import { CompletrSettings, DEFAULT_SETTINGS } from "./settings";
import { markerStateField } from "./marker_state_field";
import { EditorView } from "@codemirror/view";
import { posFromIndex } from "./editor_helpers";
import { FrontMatter } from "./provider/front_matter_provider";

export default class MyAutoCompletionPlugin extends ObsidianPlugin {
  settings: CompletrSettings;

  private snippetManager: SnippetManager;
  private suggestionPopup: SuggestionPopup;
  private periodInserter: PeriodInserter;

  removeCommand(id: string): void {
    // Implementation required by Plugin interface
  }

  registerHoverLinkSource(id: string, source: any): void {
    // Implementation required by Plugin interface
  }

  onUserEnable(): void {
    // Implementation required by Plugin interface
  }

  async onload() {
    await this.loadSettings();

    // Initialize providers
    console.log("[MyAutoCompletion] Loading word lists...");
    const wordCount = await WordList.loadFromFiles(this.app.vault, this.settings);
    console.log("[MyAutoCompletion] Loaded", wordCount, "words from word lists");

    this.snippetManager = new SnippetManager();
    this.suggestionPopup = new SuggestionPopup(this.app, this.settings, this.snippetManager);
    this.periodInserter = new PeriodInserter();

    // The main editor suggest extension
    this.registerEditorSuggest(this.suggestionPopup);

    // Listen for file openings to do file scanning (if enabled)
    this.registerEvent(this.app.workspace.on("file-open", this.onFileOpened, this));

    // Listen for front matter changes to glean key completions
    this.registerEvent(
      this.app.metadataCache.on("changed", FrontMatter.onCacheChange, FrontMatter)
    );
    this.app.workspace.onLayoutReady(() => {
      FrontMatter.loadYAMLKeyCompletions(this.app.metadataCache, this.app.vault.getMarkdownFiles());
    });

    // Register CM6 extension for snippet placeholders
    this.registerEditorExtension(markerStateField);

    // A listener to detect cursor movement, typed changes, etc.
    this.registerEditorExtension(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          // Our approach to detecting typed changes
          console.log("[MyAutoCompletion] Document changed");
          const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
          if (activeView?.editor) {
            // Call handleDocChange through a bound method
            const boundHandleDocChange = this.suggestionPopup.handleDocChange.bind(this.suggestionPopup);
            boundHandleDocChange();
          }
        }
        if (update.selectionSet) {
          // Cursor changed
          console.log("[MyAutoCompletion] Cursor changed");
          this.handleCursorActivity(posFromIndex(update.state.doc, update.state.selection.main.head));
        }
      })
    );

    // Add plugin settings tab
    this.addSettingTab(new CompletrSettingsTab(this.app, this));

    // Setup commands / hotkeys
    this.setupCommands();

    // If the user has the old editor, show a warning
    if ((this.app.vault as any).config?.legacyEditor) {
      console.log(
        "[MyAutoCompletionPlugin] Legacy editor is active. Some features may not work properly!"
      );
    }
  }

  private handleCursorActivity(cursor: { line: number; ch: number }) {
    // Cancel any double-space period insertion
    this.periodInserter.cancelInsertPeriod();

    // If the user changed lines, we don't want to auto-suggest
    if (this.suggestionPopup.lastCursorLine !== cursor.line) {
      this.suggestionPopup.preventNextTrigger();
    }
    this.suggestionPopup.lastCursorLine = cursor.line;

    // Clear placeholders if we've moved out of them
    if (!this.snippetManager.placeholderAtPos(cursor)) {
      this.snippetManager.clearAllPlaceholders();
    }

    // Force-close the suggestion popup to avoid flicker
    this.suggestionPopup.close();
  }

  onunload() {
    this.snippetManager.onunload();
    // Save any scanned words to disk
    FileScanner.saveData(this.app.vault);
  }

  private setupCommands() {
    // Because Obsidian intercepts some keys (Enter, Tab, etc.) while an editor-suggest is open,
    // we add our own bypass system below to restore normal text editor keys.

    // 1. Manually trigger the suggestion popup
    this.addCommand({
      id: "my-ac-open-suggestion-popup",
      name: "Open suggestion popup",
      hotkeys: [{ key: "#", modifiers: ["Alt"] }],
      checkCallback: (checking: boolean) => {
        // Only intercept if we can actually show suggestions
        const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
        if (!editor) return false;
        
        if (!checking) {
          this.suggestionPopup.trigger(editor, null, true);
        }
        return true;
      }
    });

    // 2. Navigate suggestions - only when popup is visible
    this.addCommand({
      id: "my-ac-select-next-suggestion",
      name: "Select next suggestion",
      hotkeys: [{ key: "ArrowDown", modifiers: [] }],
      repeatable: true,
      checkCallback: (checking: boolean) => {
        if (this.suggestionPopup.isVisible()) {
          if (!checking) {
            this.suggestionPopup.selectNextItem(SelectionDirection.NEXT);
          }
          return true;
        }
        return false; // Let editor handle arrow keys normally
      }
    });

    this.addCommand({
      id: "my-ac-select-previous-suggestion",
      name: "Select previous suggestion",
      hotkeys: [{ key: "ArrowUp", modifiers: [] }],
      repeatable: true,
      checkCallback: (checking: boolean) => {
        if (this.suggestionPopup.isVisible()) {
          if (!checking) {
            this.suggestionPopup.selectNextItem(SelectionDirection.PREVIOUS);
          }
          return true;
        }
        return false; // Let editor handle arrow keys normally
      }
    });

    // 3. Insert the selected suggestion - only when popup is visible
    this.addCommand({
      id: "my-ac-insert-selected-suggestion",
      name: "Insert selected suggestion",
      hotkeys: [{ key: "Tab", modifiers: [] }],
      checkCallback: (checking: boolean) => {
        if (this.suggestionPopup.isVisible()) {
          if (!checking) {
            const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
            if (editor) {
              this.suggestionPopup.applySelectedItem();
              this.suggestionPopup.postApplySelectedItem(editor);
            }
          }
          return true;
        }
        return false; // Let editor handle Tab normally
      }
    });

    // 4. Double-space => period
    /*this.addCommand({
      id: "my-ac-space-period-insert",
      name: "Insert period after word (double space)",
      checkCallback: (checking: boolean) => {
        if (this.settings.insertPeriodAfterSpaces && this.periodInserter.canInsertPeriod()) {
          if (!checking) {
            const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
            if (editor) {
              this.periodInserter.attemptInsert(editor);
            }
          }
          return true;
        }
        return false;
      }
    });*/

    // 5. Blacklist the currently selected suggestion - only when popup is visible
    this.addCommand({
      id: "my-ac-blacklist-current-word",
      name: "Blacklist current suggestion",
      hotkeys: [{ key: "D", modifiers: ["Shift"] }],
      checkCallback: (checking: boolean) => {
        if (this.suggestionPopup.isVisible()) {
          if (!checking) {
            SuggestionBlacklist.add(this.suggestionPopup.getSelectedItem());
            SuggestionBlacklist.saveData(this.app.vault);
            const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
            if (editor) {
              this.suggestionPopup.trigger(editor, this.app.workspace.getActiveFile(), true);
            }
          }
          return true;
        }
        return false; // Let editor handle Shift+D normally
      }
    });

    // 6. Close the suggestion popup - only when popup is visible
    this.addCommand({
      id: "my-ac-close-suggestion-popup",
      name: "Close suggestion popup",
      hotkeys: [{ key: "Escape", modifiers: [] }],
      checkCallback: (checking: boolean) => {
        if (this.suggestionPopup.isVisible()) {
          if (!checking) {
            this.suggestionPopup.close();
          }
          return true;
        }
        return false; // Let editor handle Escape normally
      }
    });

    // 7. Jump to next snippet placeholder - only when in a placeholder
    this.addCommand({
      id: "my-ac-jump-to-next-snippet-placeholder",
      name: "Jump to next snippet placeholder",
      hotkeys: [{ key: "Tab", modifiers: ["Shift"] }],
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return false;
        const placeholder = this.snippetManager.placeholderAtPos(view.editor.getCursor());
        if (!placeholder || !placeholder.marker) return false; // Let editor handle Shift+Tab normally
        
        if (!checking) {
          const editor = view.editor;
          const placeholderEnd = posFromIndex(
            editorToCodeMirrorState(placeholder.editor).doc,
            placeholder.marker.to
          );
          if (!this.snippetManager.consumeAndGotoNextMarker(editor)) {
            editor.setSelections([
              {
                anchor: {
                  ...placeholderEnd,
                  ch: Math.min(editor.getLine(placeholderEnd.line).length, placeholderEnd.ch + 1),
                },
              },
            ]);
          }
        }
        return true;
      }
    });
  }

  async loadSettings() {
    const loadedData = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);

    // Load blacklisted suggestions, then load the other providers
    await SuggestionBlacklist.loadData(this.app.vault);
    await WordList.loadFromFiles(this.app.vault, this.settings);
    await FileScanner.loadData(this.app.vault);
    await Latex.loadCommands(this.app.vault);
    await Callout.loadSuggestions(this.app.vault, this);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private onFileOpened(file: TFile) {
    if (!this.settings.fileScannerProviderEnabled || !this.settings.fileScannerScanCurrent || !file) return;
    FileScanner.scanFile(this.settings, file, true);
  }
}

// In snippet_manager.ts we reference editorToCodeMirrorState(placeholder.editor)
import { editorToCodeMirrorState } from "./editor_helpers";
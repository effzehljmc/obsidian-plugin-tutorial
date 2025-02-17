import { App, Modal, Notice, PluginSettingTab, Setting, ButtonComponent } from "obsidian";
import MyAutoCompletionPlugin from "./main";
import { FileScanner } from "./provider/scanner_provider";
import { WordList } from "./provider/word_list_provider";
import { CalloutProviderSource, CompletrSettings, WordInsertionMode } from "./settings";
import { detect } from "jschardet";
import { TextDecoder } from "util";

export default class CompletrSettingsTab extends PluginSettingTab {
  plugin: MyAutoCompletionPlugin;
  private isReloading = false;

  constructor(app: App, plugin: MyAutoCompletionPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "My Auto-Completion Settings" });

    new Setting(containerEl)
      .setName("Word character regex")
      .setDesc("Used to detect valid word characters for scanning/completion.")
      .addText((text) => {
        text.setValue(this.plugin.settings.characterRegex).onChange(async (val) => {
          try {
            new RegExp("[" + val + "]+").test("");
            text.inputEl.removeClass("completr-settings-error");
            this.plugin.settings.characterRegex = val;
            await this.plugin.saveSettings();
          } catch {
            text.inputEl.addClass("completr-settings-error");
          }
        });
      });

    new Setting(containerEl)
      .setName("Auto focus")
      .setDesc("Focus the suggestion list automatically when it opens.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoFocus).onChange(async (val) => {
          this.plugin.settings.autoFocus = val;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Auto trigger")
      .setDesc("Open suggestions automatically while typing.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoTrigger).onChange(async (val) => {
          this.plugin.settings.autoTrigger = val;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Minimum word length")
      .setDesc("Minimum length for a word to be recognized by scanning or word lists.")
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(this.plugin.settings.minWordLength + "").onChange(async (val) => {
          const n = parseInt(val, 10);
          if (Number.isNaN(n)) return;
          this.plugin.settings.minWordLength = n;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Minimum trigger length")
      .setDesc("Minimum typed characters to trigger completions (except LaTeX which has a separate option).")
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(this.plugin.settings.minWordTriggerLength + "").onChange(async (val) => {
          const n = parseInt(val, 10);
          if (Number.isNaN(n)) return;
          this.plugin.settings.minWordTriggerLength = n;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Word insertion mode")
      .addDropdown((d) => {
        d.addOption(WordInsertionMode.IGNORE_CASE_REPLACE, WordInsertionMode.IGNORE_CASE_REPLACE);
        d.addOption(WordInsertionMode.IGNORE_CASE_APPEND, WordInsertionMode.IGNORE_CASE_APPEND);
        d.addOption(WordInsertionMode.MATCH_CASE_REPLACE, WordInsertionMode.MATCH_CASE_REPLACE);
        d.setValue(this.plugin.settings.wordInsertionMode).onChange(async (val) => {
          this.plugin.settings.wordInsertionMode = val as WordInsertionMode;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Ignore diacritics")
      .setDesc("Ignore accented characters while filtering matches (e.g. Hello matches Héllø).")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.ignoreDiacriticsWhenFiltering).onChange(async (val) => {
          this.plugin.settings.ignoreDiacriticsWhenFiltering = val;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Insert space after complete")
      .setDesc("Whether to automatically add a space after you accept a suggestion.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.insertSpaceAfterComplete).onChange(async (val) => {
          this.plugin.settings.insertSpaceAfterComplete = val;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Insert period after double space")
      .setDesc("If the plugin inserted a space, pressing space again can insert a period.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.insertPeriodAfterSpaces).onChange(async (val) => {
          this.plugin.settings.insertPeriodAfterSpaces = val;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl("h3", { text: "LaTeX Provider" });
    this.createEnabledToggle(
      containerEl,
      "Enable LaTeX Provider",
      "latexProviderEnabled",
      "Enable or disable completions for LaTeX commands."
    );

    new Setting(containerEl)
      .setName("Trigger in code blocks")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.latexTriggerInCodeBlocks).onChange(async (val) => {
          this.plugin.settings.latexTriggerInCodeBlocks = val;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Ignore case (LaTeX)")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.latexIgnoreCase).onChange(async (val) => {
          this.plugin.settings.latexIgnoreCase = val;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Min word length (LaTeX)")
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(this.plugin.settings.latexMinWordTriggerLength + "").onChange(async (val) => {
          const n = parseInt(val, 10);
          if (!Number.isNaN(n)) {
            this.plugin.settings.latexMinWordTriggerLength = n;
            await this.plugin.saveSettings();
          }
        });
      });

    containerEl.createEl("h3", { text: "File Scanner" });
    this.createEnabledToggle(
      containerEl,
      "Enable File Scanner",
      "fileScannerProviderEnabled",
      "Scans your .md files for words."
    );
    new Setting(containerEl)
      .setName("Scan current file on open")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.fileScannerScanCurrent).onChange(async (val) => {
          this.plugin.settings.fileScannerScanCurrent = val;
          await this.plugin.saveSettings();
        })
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("search")
          .setTooltip("Scan all .md in vault")
          .onClick(() => {
            new ConfirmationModal(
              this.app,
              "Scan entire vault?",
              "This may take a while on large vaults!",
              (b) => b.setButtonText("Scan").setCta(),
              async () => {
                const files = this.app.vault.getMarkdownFiles();
                await FileScanner.scanFiles(this.plugin.settings, files);
                new Notice("Vault scanned for words.");
              }
            ).open();
          })
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("trash")
          .setTooltip("Delete all scanned words")
          .onClick(() => {
            new ConfirmationModal(
              this.app,
              "Delete scanned words?",
              "They will be removed from suggestions. You can re-scan later.",
              (b) => b.setButtonText("Delete").setWarning(),
              async () => {
                await FileScanner.deleteAllWords(this.app.vault);
                new Notice("Scanned words deleted.");
              }
            ).open();
          })
      );

    containerEl.createEl("h3", { text: "Word Lists" });
    this.createEnabledToggle(
      containerEl,
      "Enable Word List Provider",
      "wordListProviderEnabled",
      "Loads .txt or .dic files from the wordLists folder."
    );

    new Setting(containerEl)
      .setName("Word List Files")
      .setDesc("Add or remove dictionary-like files here.")
      .addExtraButton((btn) =>
        btn
          .setIcon("switch")
          .setTooltip("Reload words")
          .onClick(async () => {
            if (this.isReloading) return;
            this.isReloading = true;
            const count = await WordList.loadFromFiles(this.app.vault, this.plugin.settings);
            this.isReloading = false;
            new Notice(`Loaded ${count} words from your lists.`);
            this.display();
          })
      )
      .addButton((b) => {
        const input = createEl("input", { attr: { type: "file", multiple: true, accept: ".txt,.dic" } });
        input.onchange = async () => {
          if (!input.files || !input.files.length) return;
          let changed = false;
          for (let i = 0; i < input.files.length; i++) {
            const file = input.files[i];
            const buf = await file.arrayBuffer();
            const guess = detect(Buffer.from(buf.slice(0, 1024))).encoding;
            const text = new TextDecoder(guess).decode(buf);
            const success = await WordList.importWordList(this.app.vault, file.name, text);
            if (!success) {
              new Notice(`Cannot import ${file.name} - already exists.`);
            } else {
              changed = true;
            }
          }
          if (changed) {
            const count = await WordList.loadFromFiles(this.app.vault, this.plugin.settings);
            new Notice(`Reloaded word lists: ${count} words total.`);
            this.display();
          }
        };
        b.buttonEl.appendChild(input);
        b.setButtonText("Add").setCta().onClick(() => input.click());
      });

    // Show existing files
    const listDiv = containerEl.createDiv();
    WordList.getRelativeFilePaths(this.app.vault).then((names) => {
      for (const fileName of names) {
        new Setting(listDiv)
          .setName(fileName)
          .addExtraButton((btn) =>
            btn
              .setIcon("trash")
              .setTooltip("Delete word list")
              .onClick(() => {
                new ConfirmationModal(
                  this.app,
                  "Delete " + fileName + "?",
                  "It will be removed, words vanish from suggestions until re-import.",
                  (b) => b.setButtonText("Delete").setWarning(),
                  async () => {
                    await WordList.deleteWordList(this.app.vault, fileName);
                    await WordList.loadFromFiles(this.app.vault, this.plugin.settings);
                    this.display();
                  }
                ).open();
              })
          );
      }
    });

    containerEl.createEl("h3", { text: "Front Matter Provider" });
    this.createEnabledToggle(
      containerEl,
      "Enable Front Matter",
      "frontMatterProviderEnabled",
      "Suggest YAML keys and known values from your vault."
    );
    new Setting(containerEl)
      .setName("Ignore case (Front Matter)")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.frontMatterIgnoreCase).onChange(async (val) => {
          this.plugin.settings.frontMatterIgnoreCase = val;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("Append tag suffix")
      .setDesc("When completing tags, auto-add comma or newline for next tag.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.frontMatterTagAppendSuffix).onChange(async (val) => {
          this.plugin.settings.frontMatterTagAppendSuffix = val;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl("h3", { text: "Callout Provider" });
    this.createEnabledToggle(
      containerEl,
      "Enable Callout Suggestions",
      "calloutProviderEnabled",
      "Suggest [!info], [!warning], etc. for block quotes."
    );

    new Setting(containerEl)
      .setName("Callout Source")
      .setDesc("Whether to read from local JSON or from the Callout Manager plugin (if installed).")
      .addDropdown((d) => {
        d.addOption(CalloutProviderSource.COMPLETR, "Completr JSON");
        d.addOption(CalloutProviderSource.CALLOUT_MANAGER, "Callout Manager");
        d.setValue(this.plugin.settings.calloutProviderSource).onChange(async (val) => {
          this.plugin.settings.calloutProviderSource = val as CalloutProviderSource;
          await this.plugin.saveSettings();
        });
      });
  }

  private createEnabledToggle(
    container: HTMLElement,
    name: string,
    propertyName: keyof CompletrSettings,
    description: string
  ) {
    new Setting(container)
      .setName(name)
      .setDesc(description)
      .addToggle((t) => {
        t.setValue(this.plugin.settings[propertyName] as boolean).onChange(async (val) => {
          // @ts-ignore
          this.plugin.settings[propertyName] = val;
          await this.plugin.saveSettings();
        });
      });
  }
}

class ConfirmationModal extends Modal {
  constructor(
    app: App,
    title: string,
    body: string,
    configure: (b: ButtonComponent) => ButtonComponent,
    onConfirm: () => Promise<void>
  ) {
    super(app);
    this.titleEl.setText(title);
    this.contentEl.setText(body);
    new Setting(this.modalEl)
      .addButton((b) => {
        configure(b);
        b.onClick(async () => {
          await onConfirm();
          this.close();
        });
      })
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
  }
}
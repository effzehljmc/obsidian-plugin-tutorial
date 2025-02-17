import { Suggestion, SuggestionContext, SuggestionProvider } from "./provider";
import { MyAutoCompletionSettings, intoCompletrPath } from "../settings";
import { BlockType, getLatexBlockType, maybeLowerCase } from "../editor_helpers";
import { Notice, Vault } from "obsidian";
import { SuggestionBlacklist } from "./blacklist";

// We read latex commands from a file if present
const LATEX_COMMANDS_PATH = "latex_commands.json";

class LatexSuggestionProvider implements SuggestionProvider {
  private loadedCommands: Suggestion[] = [];

  getSuggestions(context: SuggestionContext, settings: MyAutoCompletionSettings): Suggestion[] {
    if (!settings.enableLatexProvider) return [];
    if (!context.query || context.query.length < settings.minWordTriggerLength) return [];

    const latexBlockType = getLatexBlockType(context.editor, context.start, settings.latexTriggerInCodeBlocks);
    if (!latexBlockType) return [];

    const singleLineBlock = (latexBlockType === BlockType.DOLLAR_SINGLE);
    const ignoreCase = settings.latexIgnoreCase;
    const typed = maybeLowerCase(context.query, ignoreCase);

    // If the typed char is a backslash, remove it from the final replacement
    const isSeparatorBackslash = (context.separatorChar === "\\");

    // Filter
    let results = this.loadedCommands.filter(cmd => {
      return cmd.getDisplayNameLowerCase(ignoreCase).includes(typed);
    }).map(s => {
      // Potentially remove the leading "\" if the user typed one
      let repl = s.replacement;
      if (isSeparatorBackslash) {
        if (repl.startsWith("\\")) {
          repl = repl.slice(1);
        }
      }
      // Single-dollar means inline => remove newlines
      if (singleLineBlock) {
        repl = repl.replace(/\n/g, "");
      }
      return {
        displayName: s.displayName,
        replacement: repl,
        priority: s.getDisplayNameLowerCase(ignoreCase).indexOf(typed),
      };
    });

    // Sort so that closer matches come first
    results.sort((a, b) => {
      let d = a.priority - b.priority;
      if (d === 0) {
        // Shorter commands first
        d = a.displayName.length - b.displayName.length;
      }
      return d;
    });

    return results.map(item => new Suggestion(item.displayName, item.replacement));
  }

  async loadCommands(vault: Vault) {
    const path = intoCompletrPath(vault, LATEX_COMMANDS_PATH);
    if (!(await vault.adapter.exists(path))) {
      // If no custom file, store defaults
      const defaultList = generateDefaultLatexCommands();
      await vault.adapter.write(path, JSON.stringify(defaultList, null, 2));
      this.loadedCommands = defaultList;
    } else {
      // Load user file
      try {
        const data = await vault.adapter.read(path);
        const arr = JSON.parse(data);
        const commands = arr.map((obj: any) => {
          if (typeof obj === "string") {
            // For string entries, use it as both display name and replacement
            const displayName = obj.split("\n")[0]; // Take first line as display name
            return new Suggestion(displayName, obj);
          }
          // For object entries, ensure display name is single line
          const displayName = obj.displayName.split("\n")[0];
          return new Suggestion(displayName, obj.replacement);
        });
        this.loadedCommands = commands;
      } catch (e: any) {
        console.error("Failed to parse latex_commands.json:", e);
        new Notice("Could not parse latex commands file. Using defaults.");
        this.loadedCommands = generateDefaultLatexCommands();
      }
    }

    this.loadedCommands = SuggestionBlacklist.filter(this.loadedCommands);
  }
}

export const Latex = new LatexSuggestionProvider();

// Example default commands
function generateDefaultLatexCommands(): Suggestion[] {
  return [
    // Simple commands
    new Suggestion("\\alpha", "\\alpha"),
    new Suggestion("\\beta", "\\beta"),
    new Suggestion("\\gamma", "\\gamma"),
    new Suggestion("\\delta", "\\delta"),
    new Suggestion("\\epsilon", "\\epsilon"),
    new Suggestion("\\zeta", "\\zeta"),
    new Suggestion("\\eta", "\\eta"),
    new Suggestion("\\theta", "\\theta"),
    new Suggestion("\\iota", "\\iota"),
    new Suggestion("\\kappa", "\\kappa"),
    
    // Math operators
    new Suggestion("\\frac", "\\frac{#}{#}"),
    new Suggestion("\\sqrt", "\\sqrt{#}"),
    new Suggestion("\\sum", "\\sum_{#}^{#}"),
    new Suggestion("\\int", "\\int_{#}^{#}"),
    
    // Environments
    new Suggestion("\\begin{align}", "\\begin{align}\n#\n\\end{align}"),
    new Suggestion("\\begin{equation}", "\\begin{equation}\n#\n\\end{equation}"),
    new Suggestion("\\begin{matrix}", "\\begin{matrix}\n#\n\\end{matrix}"),
    
    // Text formatting
    new Suggestion("\\textbf", "\\textbf{#}"),
    new Suggestion("\\textit", "\\textit{#}"),
    new Suggestion("\\underline", "\\underline{#}"),
    new Suggestion("\\overline", "\\overline{#}")
  ];
}
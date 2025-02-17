import { Vault } from "obsidian";

export enum WordInsertionMode {
    MATCH_CASE_REPLACE = "Case-Sensitive & Replace",
    IGNORE_CASE_REPLACE = "Ignore-Case & Replace",
    APPEND = "Append"
}

export enum CalloutProviderSource {
    COMPLETR = "Completr",
    CALLOUT_MANAGER = "Callout Manager"
}

export interface MyAutoCompletionSettings {
    // Core settings
    autoTrigger: boolean;
    minWordTriggerLength: number;
    maxLookBackDistance: number;
    characterRegex: string;
    insertSpaceAfterComplete: boolean;
    wordInsertionMode: WordInsertionMode;
    autoFocus: boolean;
    ignoreDiacriticsWhenFiltering: boolean;
    insertPeriodAfterSpaces: boolean;

    // Provider settings
    enableWordListProvider: boolean;
    enableLatexProvider: boolean;
    enableCalloutProvider: boolean;
    enableFrontMatterProvider: boolean;
    enableFileScannerProvider: boolean;

    // LaTeX specific settings
    latexTriggerInCodeBlocks: boolean;
    latexIgnoreCase: boolean;

    // File scanner specific settings
    fileScannerScanCurrent: boolean;

    // Front matter specific settings
    frontMatterTagAppendSuffix: boolean;
    frontMatterIgnoreCase: boolean;

    // Callout specific settings
    calloutProviderSource: CalloutProviderSource;
}

export const DEFAULT_SETTINGS: MyAutoCompletionSettings = {
    // Core settings
    autoTrigger: true,
    minWordTriggerLength: 2,
    maxLookBackDistance: 50,
    characterRegex: "\\w",
    insertSpaceAfterComplete: true,
    wordInsertionMode: WordInsertionMode.IGNORE_CASE_REPLACE,
    autoFocus: true,
    ignoreDiacriticsWhenFiltering: false,
    insertPeriodAfterSpaces: false,

    // Provider settings
    enableWordListProvider: true,
    enableLatexProvider: true,
    enableCalloutProvider: true,
    enableFrontMatterProvider: true,
    enableFileScannerProvider: true,

    // LaTeX specific settings
    latexTriggerInCodeBlocks: true,
    latexIgnoreCase: true,

    // File scanner specific settings
    fileScannerScanCurrent: true,

    // Front matter specific settings
    frontMatterTagAppendSuffix: true,
    frontMatterIgnoreCase: true,

    // Callout specific settings
    calloutProviderSource: CalloutProviderSource.COMPLETR
};

export function intoCompletrPath(vault: Vault, ...sub: string[]): string {
    return vault.configDir + "/plugins/my-auto-completion-plugin/" + sub.join("/");
}
import { Editor, TFile } from "obsidian";
import type { MyAutoCompletionSettings } from "./settings";

export interface SuggestionContext {
    editor: Editor;
    file: TFile | null;
    query: string;
    separatorChar: string;
}

export interface Suggestion {
    value: string;
    description?: string;
    insertText?: string;
    insertOffset?: number;
}

export interface SuggestionProvider {
    getSuggestions(context: SuggestionContext, settings: MyAutoCompletionSettings): Suggestion[];
    blocksAllOtherProviders?: boolean;
    isEnabled?(settings: MyAutoCompletionSettings): boolean;
} 
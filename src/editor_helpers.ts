import { Editor, EditorPosition } from "obsidian";
import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export function posFromIndex(doc: Text, offset: number): EditorPosition {
  const line = doc.lineAt(offset);
  return { line: line.number - 1, ch: offset - line.from };
}

export function indexFromPos(doc: Text, pos: EditorPosition): number {
  const line = doc.line(pos.line + 1);
  return Math.min(line.from + Math.max(0, pos.ch), line.to);
}

export function editorToCodeMirrorState(editor: Editor): EditorState {
  return (editor as any).cm.state;
}
export function editorToCodeMirrorView(editor: Editor): EditorView {
  return (editor as any).cm;
}

export function maybeLowerCase(str: string, lower: boolean): string {
  return lower ? str.toLowerCase() : str;
}

export function matchWordBackwards(
  editor: Editor,
  cursor: EditorPosition,
  charPredicate: (ch: string) => boolean,
  maxLookBack: number = 50
) {
  let query = "";
  let separatorChar = null;
  const start = Math.max(0, cursor.ch - maxLookBack);

  for (let i = cursor.ch - 1; i >= start; i--) {
    const c = editor.getRange({ line: cursor.line, ch: i }, { line: cursor.line, ch: i + 1 });
    if (!charPredicate(c)) {
      separatorChar = c;
      break;
    }
    query = c + query;
  }

  return { query, separatorChar };
}

export function isInFrontMatterBlock(editor: Editor, pos: EditorPosition): boolean {
  if (pos.line === 0) return false;
  const bounds = getFrontMatterBounds(editor);
  if (!bounds) return false;
  return pos.line > bounds.startLine && pos.line < bounds.endLine;
}

function getFrontMatterBounds(editor: Editor): { startLine: number; endLine: number } | null {
  let startLine = -1;
  for (let i = 0; i < Math.min(5, editor.lastLine()); i++) {
    if (editor.getLine(i) !== "---") continue;
    startLine = i;
    break;
  }
  if (startLine === -1) return null;

  let endLine = -1;
  for (let i = startLine + 1; i <= Math.min(50, editor.lastLine()); i++) {
    if (editor.getLine(i) === "---") {
      endLine = i;
      break;
    }
  }
  if (endLine === -1) return null;

  return { startLine, endLine };
}

/** Distinguishes between inline `$...$`, block `$$...$$`, inline code, etc. */
export class BlockType {
  public static DOLLAR_MULTI = new BlockType("$$", true);
  public static DOLLAR_SINGLE = new BlockType("$", false, BlockType.DOLLAR_MULTI);
  public static CODE_MULTI = new BlockType("```", true);
  public static CODE_SINGLE = new BlockType("`", false, BlockType.CODE_MULTI);
  public static NONE = new BlockType("", false);

  static {
    BlockType.DOLLAR_MULTI.otherType0 = BlockType.DOLLAR_SINGLE;
    BlockType.CODE_MULTI.otherType0 = BlockType.CODE_SINGLE;
  }

  private constructor(public readonly c: string, public readonly isMultiLine: boolean, private otherType0: BlockType | null = null) {}

  public get isDollarBlock() {
    return this === BlockType.DOLLAR_SINGLE || this === BlockType.DOLLAR_MULTI;
  }
  public get isCodeBlock() {
    return !this.isDollarBlock && this !== BlockType.NONE;
  }
  public get otherType() {
    return this.otherType0;
  }

  public static SINGLE_TYPES = [BlockType.DOLLAR_SINGLE, BlockType.CODE_SINGLE];
}

/**
 * Attempts to detect if the cursor is inside `$...$` or `$$...$$` or in code blocks, etc.
 */
export function getLatexBlockType(editor: Editor, pos: EditorPosition, triggerInCodeBlocks: boolean): BlockType {
  const frontMatter = getFrontMatterBounds(editor) ?? { startLine: -1, endLine: -1 };
  const stack: { type: BlockType; line: number }[] = [];

  const startLine = Math.max(0, pos.line - 5000);
  for (let lineIndex = startLine; lineIndex <= pos.line; lineIndex++) {
    if (lineIndex >= frontMatter.startLine && lineIndex <= frontMatter.endLine) continue;
    const line = editor.getLine(lineIndex);
    for (let j = lineIndex === pos.line ? pos.ch - 1 : line.length - 1; j >= 0; j--) {
      const c = line.charAt(j);
      let bt = BlockType.SINGLE_TYPES.find((b) => b.c.charAt(0) === c);
      if (!bt) continue;
      if (j > 0 && line.charAt(j - 1) === "\\") {
        // Escaped
        continue;
      }
      const multiLen = bt.otherType?.c.length ?? 0; // e.g. 2 for '$$'
      const isMulti = j + 1 >= multiLen && substringMatches(line, bt.otherType?.c ?? "", j - multiLen + 1);
      if (isMulti && bt.otherType) {
        j -= multiLen - 1;
        bt = bt.otherType;
      }
      stack.push({ type: bt, line: lineIndex });
    }
  }

  if (stack.length < 1) return BlockType.NONE;

  let idx = 0;
  while (true) {
    if (idx >= stack.length) return BlockType.NONE;
    const block = stack[idx];
    const nextIndex = stack.findIndex((x, i) => i > idx && x.type === block.type);
    if (nextIndex === -1) {
      // Unclosed block
      if (!triggerInCodeBlocks && block.type.isCodeBlock) return BlockType.NONE;
      if (block.type.isCodeBlock) {
        // e.g. multi-line code
        return block.type;
      }
      // Single $ might need to check if on the same line
      if (block.type === BlockType.DOLLAR_SINGLE && block.line !== pos.line) {
        idx++;
        continue;
      }
      return block.type;
    } else {
      // Pair found => skip them
      idx = nextIndex + 1;
    }
  }
}

function substringMatches(str: string, target: string, from: number): boolean {
  const end = from + target.length;
  if (end > str.length) return false;
  for (let i = from; i < end; i++) {
    if (str.charAt(i) !== target.charAt(i - from)) return false;
  }
  return true;
}
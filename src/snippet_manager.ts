import { Editor, EditorPosition } from "obsidian";
import { Decoration } from "@codemirror/view";
import {
  markerStateField,
  addMark,
  clearMarks,
  removeMarkBySpecAttribute,
} from "./marker_state_field";
import { editorToCodeMirrorView, editorToCodeMirrorState, indexFromPos, posFromIndex } from "./editor_helpers";

const COLORS = ["lightskyblue", "orange", "lime", "pink", "cornsilk", "magenta", "navajowhite"];

export class PlaceholderReference {
  editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  get marker() {
    const st = editorToCodeMirrorState(this.editor);
    const iter = st.field(markerStateField).iter();
    while (iter.value) {
      if (iter.value.spec.reference === this) {
        return { from: iter.from, to: iter.to, value: iter.value };
      }
      iter.next();
    }
    return null;
  }

  removeFromEditor() {
    editorToCodeMirrorView(this.editor).dispatch({
      effects: removeMarkBySpecAttribute.of({ attribute: "reference", reference: this }),
    });
  }
}

export default class SnippetManager {
  private placeholders: PlaceholderReference[] = [];

  handleSnippet(value: string, start: EditorPosition, editor: Editor) {
    // Decide which color to assign
    let colorIndex = 0;
    for (; colorIndex < COLORS.length; colorIndex++) {
      if (
        !this.placeholders.find((p) =>
          (p.marker?.value?.spec?.attributes?.class ?? "").endsWith(colorIndex.toString())
        )
      ) {
        break;
      }
    }
    if (colorIndex >= COLORS.length) {
      colorIndex = Math.floor(Math.random() * COLORS.length);
    }

    const view = editorToCodeMirrorView(editor);
    const lines = value.split("\n");

    // If the snippet text has multiple lines, we handle from bottom to top
    for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex--) {
      const lineText = lines[lineIndex];
      for (let i = lineText.length - 1; i >= 0; i--) {
        const c = lineText.charAt(i);
        if (c !== "#" && c !== "~") continue;

        const offsetInLine = i;
        const lineBaseOffset = lineIndex === 0 ? start.ch : 0;
        if (c === "~") {
          // The ~ is simply the final cursor position
          const pos = { line: start.line + lineIndex, ch: lineBaseOffset + offsetInLine };
          editor.replaceRange("", pos, { ...pos, ch: pos.ch + 1 });
          continue;
        }

        // c === "#"
        const ref = new PlaceholderReference(editor);
        const from = indexFromPos(view.state.doc, {
          line: start.line + lineIndex,
          ch: lineBaseOffset + offsetInLine,
        });
        const to = from + 1;
        const deco = Decoration.mark({
          inclusive: true,
          attributes: {
            style: "border-width: 1px 0 1px 0; border-style: solid;",
            class: "completr-suggestion-placeholder" + colorIndex,
          },
          reference: ref,
        }).range(from, to);

        view.dispatch({ effects: addMark.of(deco) });
        this.placeholders.unshift(ref);
      }
    }

    // Move cursor to the first placeholder
    if (this.placeholders.length > 0) {
      this.selectMarker(this.placeholders[0]);
    }
  }

  consumeAndGotoNextMarker(editor: Editor): boolean {
    // Remove the placeholder at the cursor
    const oldPlaceholder = this.placeholders.shift();
    if (oldPlaceholder) oldPlaceholder.removeFromEditor();
    if (this.placeholders.length < 1) return false;

    const nextPh = this.placeholders[0];
    const nextRange = nextPh.marker;
    if (!nextRange) return false;

    this.selectMarker(nextPh);
    return true;
  }

  selectMarker(ref: PlaceholderReference) {
    if (!ref) return;
    const st = editorToCodeMirrorState(ref.editor);
    const m = ref.marker;
    if (!m) return;
    const from = posFromIndex(st.doc, m.from);
    ref.editor.setSelection(from, { line: from.line, ch: from.ch + 1 });
  }

  placeholderAtPos(pos: EditorPosition) {
    for (let i = 0; i < this.placeholders.length; i++) {
      const ph = this.placeholders[i];
      const r = ph.marker;
      if (!r) {
        this.placeholders.splice(i, 1);
        i--;
        continue;
      }
      const from = posFromIndex(editorToCodeMirrorState(ph.editor).doc, r.from);
      const to = posFromIndex(editorToCodeMirrorState(ph.editor).doc, r.to);
      if (pos.line === from.line && pos.ch >= from.ch && pos.ch <= to.ch) {
        return ph;
      }
    }
    return null;
  }

  clearAllPlaceholders() {
    if (this.placeholders.length === 0) return;
    const first = this.placeholders[0];
    const view = editorToCodeMirrorView(first.editor);
    view.dispatch({ effects: clearMarks.of(null) });
    this.placeholders = [];
  }

  onunload() {
    this.clearAllPlaceholders();
  }
}
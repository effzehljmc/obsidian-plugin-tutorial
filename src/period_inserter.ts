import { Editor } from "obsidian";

export default class PeriodInserter {
  private canInsert = false;

  allowInsertPeriod() {
    this.canInsert = true;
  }
  cancelInsertPeriod() {
    this.canInsert = false;
  }
  canInsertPeriod(): boolean {
    return this.canInsert;
  }

  attemptInsert(editor: Editor) {
    this.cancelInsertPeriod();
    const cursor = editor.getCursor();
    // We just inserted a space, so let's insert a period right before it
    editor.replaceRange(".", { line: cursor.line, ch: cursor.ch - 1 });
  }
}
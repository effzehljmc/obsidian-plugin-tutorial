import { Range, RangeSet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

export const addMark = StateEffect.define<Range<Decoration>>();
export const clearMarks = StateEffect.define<null>();
export const removeMarkBySpecAttribute = StateEffect.define<{ attribute: string; reference: any }>();

export const markerStateField = StateField.define<RangeSet<Decoration>>({
  create() {
    return Decoration.none;
  },
  update(value, tr) {
    // Map existing decorations through changes
    value = value.map(tr.changes);

    for (const effect of tr.effects) {
      if (effect.is(addMark)) {
        value = value.update({ add: [effect.value] });
      } else if (effect.is(clearMarks)) {
        value = value.update({ filter: () => false });
      } else if (effect.is(removeMarkBySpecAttribute)) {
        value = value.update({
          filter: (_from, _to, deco) => {
            const attr = effect.value.attribute;
            return deco.spec[attr] !== effect.value.reference;
          },
        });
      }
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});
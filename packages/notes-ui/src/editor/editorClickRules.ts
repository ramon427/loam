import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * Double- and triple-click rules for the note editor, run from its ProseMirror
 * `handleDoubleClick` and `handleTripleClick` props. A click right of a line's
 * end resolves to the end of its block, where the browser's own word and line
 * selection picks the break between blocks instead: typing over that selection
 * joins the two blocks. Each rule returns true when it set the selection.
 */

/** Stands in for an inline node without text (a mention, a chip), so offsets match positions. */
const LEAF = "￼";

const select = (view: EditorView, from: number, to: number) =>
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));

/** A double-click at the end of a line selects its last word. */
export const selectLastWordAtLineEnd = (view: EditorView, pos: number) => {
  const $pos = view.state.doc.resolve(pos);
  const block = $pos.parent;
  if (!block.isTextblock || $pos.parentOffset !== block.content.size) return false;
  const start = $pos.start();
  const text = view.state.doc.textBetween(start, pos, undefined, LEAF);
  const match = /(\S+)\s*$/u.exec(text);
  if (!match) return false;
  const from = start + match.index;
  select(view, from, from + match[1]!.length);
  return true;
};

/** A triple-click selects the text of the block under it, and nothing past its end. */
export const selectBlockText = (view: EditorView, pos: number) => {
  const $pos = view.state.doc.resolve(pos);
  if (!$pos.parent.isTextblock || $pos.parent.content.size === 0) return false;
  select(view, $pos.start(), $pos.end());
  return true;
};

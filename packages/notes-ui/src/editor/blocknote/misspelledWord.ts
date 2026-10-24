import { closeHistory } from "@tiptap/pm/history";

import type { NoteBlockEditor } from "../noteEditorSchema";
import type { NotesSpelling } from "../../host/notesHost";

const WORD_CHARACTER = /[\p{L}\p{M}\p{N}'’]/u;

/** A misspelled word in the note, where it is, and what the host's spell checker offers. */
export type MisspelledWord = {
  word: string;
  from: number;
  to: number;
  suggestions: readonly string[];
};

/** The word's bounds around `offset` in `text`, apostrophes kept inside it but not at its edges. */
const wordBounds = (text: string, offset: number) => {
  let start = offset;
  let end = offset;
  while (start > 0 && WORD_CHARACTER.test(text[start - 1] ?? "")) start -= 1;
  while (end < text.length && WORD_CHARACTER.test(text[end] ?? "")) end += 1;
  while (start < end && /['’]/.test(text[start] ?? "")) start += 1;
  while (end > start && /['’]/.test(text[end - 1] ?? "")) end -= 1;
  return start < end ? { start, end } : null;
};

/** The word under a right-click at (`x`, `y`) when the host's spell checker says it's misspelled. */
export function misspelledWordAt(
  editor: NoteBlockEditor,
  spelling: NotesSpelling,
  x: number,
  y: number,
): MisspelledWord | null {
  const view = editor.prosemirrorView;
  const hit = view.posAtCoords({ left: x, top: y });
  if (!hit) return null;
  const $pos = view.state.doc.resolve(hit.pos);
  const block = $pos.parent;
  if (!block.isTextblock || block.type.spec.code) return null;
  // One character per leaf (a mention, a hard break), so offsets line up with positions.
  const text = block.textBetween(0, block.content.size, undefined, "￼");
  const bounds = wordBounds(text, $pos.parentOffset);
  if (!bounds || bounds.end - bounds.start > 100) return null;
  const word = text.slice(bounds.start, bounds.end);
  const suggestions = spelling.suggestions(word);
  if (!suggestions) return null;
  const from = $pos.start() + bounds.start;
  return { word, from, to: from + word.length, suggestions: suggestions.slice(0, 5) };
}

/** Types `replacement` over the word, as one undo step; nothing if the word changed meanwhile. */
export function replaceMisspelledWord(
  editor: NoteBlockEditor,
  { word, from, to }: MisspelledWord,
  replacement: string,
) {
  editor.transact((tr) => {
    if (to > tr.doc.content.size || tr.doc.textBetween(from, to) !== word) return;
    closeHistory(tr);
    tr.insertText(replacement, from, to);
  });
  editor.focus();
}

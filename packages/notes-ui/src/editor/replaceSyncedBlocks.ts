import type { Block } from "@blocknote/core";

import type { NoteBlockEditor } from "./noteEditorSchema";

const sameBlock = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Shows a page tab's blocks as sync brought them without starting the editor
 * over: only the run of top-level blocks that differs is replaced, so focus and
 * a cursor outside that run stay where they are. Undo doesn't take it back,
 * since the change is someone else's.
 */
export function replaceSyncedBlocks(editor: NoteBlockEditor, next: readonly unknown[]) {
  const current = editor.document;
  let start = 0;
  while (start < current.length && start < next.length && sameBlock(current[start], next[start]))
    start += 1;
  let currentEnd = current.length;
  let nextEnd = next.length;
  while (
    currentEnd > start &&
    nextEnd > start &&
    sameBlock(current[currentEnd - 1], next[nextEnd - 1])
  ) {
    currentEnd -= 1;
    nextEnd -= 1;
  }
  const removed = current.slice(start, currentEnd);
  const inserted = next.slice(start, nextEnd) as Block[];
  if (removed.length === 0 && inserted.length === 0) return;
  editor.transact((transaction) => {
    transaction.setMeta("addToHistory", false);
    if (removed.length > 0) editor.replaceBlocks(removed, inserted);
    else if (start > 0) editor.insertBlocks(inserted, current[start - 1]!, "after");
    else editor.insertBlocks(inserted, current[0]!, "before");
  });
}

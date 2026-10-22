import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core";

import type { NoteBlock, NoteBlockEditor, NotePartialBlock } from "./noteEditorSchema";

const isEmptyParagraph = (block: NoteBlock | undefined): block is NoteBlock =>
  block?.type === "paragraph" &&
  Array.isArray(block.content) &&
  block.content.length === 0 &&
  block.children.length === 0;

/**
 * Puts the caret at the start of an empty paragraph right after `block`,
 * adding one unless it's already there, so writing goes on below a block
 * without text.
 */
const continueBelow = (editor: NoteBlockEditor, blockId: string) => {
  const next = editor.getNextBlock(blockId);
  const paragraph = isEmptyParagraph(next)
    ? next
    : editor.insertBlocks([{ type: "paragraph" }], blockId, "after")[0]!;
  editor.setTextCursorPosition(paragraph, "start");
};

/**
 * Inserts a block without text, such as a divider or a graph snapshot, the
 * way a slash command does (in place of the caret's block when that's empty,
 * otherwise below it), then continues in an empty paragraph under it.
 * BlockNote alone leaves the caret on the new block when it's last, where
 * typing goes nowhere, or at the end of the next block's text.
 */
export const insertBlockWithoutText = (editor: NoteBlockEditor, block: NotePartialBlock) =>
  editor.transact(() => {
    const inserted = insertOrUpdateBlockForSlashMenu(editor, block);
    continueBelow(editor, inserted.id);
  });

/**
 * Typing the third "-" of "---" alone in a paragraph turns it into a divider
 * with an empty paragraph below for the caret. BlockNote's own rule leaves the
 * divider selected, where typing does nothing, and drops any text after the
 * caret, so with text after it the "-" is just typed.
 */
export const typeDividerShortcut = (
  editor: NoteBlockEditor,
  from: number,
  to: number,
  text: string,
) => {
  if (text !== "-" || from !== to) return false;
  const { $from } = editor.prosemirrorState.selection;
  if ($from.parent.type.name !== "paragraph") return false;
  if ($from.parent.textBetween(0, $from.parentOffset) !== "--") return false;
  if ($from.parentOffset !== $from.parent.content.size) {
    editor.transact((tr) => tr.insertText(text, from, to));
    return true;
  }
  editor.transact(() => {
    const { block } = editor.getTextCursorPosition();
    continueBelow(editor, editor.updateBlock(block, { type: "divider" }).id);
  });
  return true;
};

import type { NoteBlockEditor, NotePartialBlock } from "@loam/notes-ui/editor/noteEditorSchema";

import { pluginHost } from "./host";
import type { PluginSlashItem } from "./pluginContributions";

/**
 * Runs a plugin's slash menu item and puts the Markdown it gives where the caret was: in place
 * of the empty line the slash command was typed on, or below the caret's block.
 */
export const runPluginSlashItem = async (
  editor: NoteBlockEditor,
  item: PluginSlashItem,
  noteId: string,
) => {
  const markdown = await pluginHost.runSlashItem(item, noteId);
  if (!markdown?.trim()) return;
  const { parseMarkdown } = await import("@loam/notes-ui/editor/blockParsers");
  const blocks = parseMarkdown(markdown) as NotePartialBlock[];
  if (blocks.length === 0) return;
  editor.transact(() => {
    const { block } = editor.getTextCursorPosition();
    const empty =
      block.type === "paragraph" &&
      Array.isArray(block.content) &&
      block.content.length === 0 &&
      block.children.length === 0;
    const inserted = editor.insertBlocks(blocks, block, "after");
    if (empty) editor.removeBlocks([block]);
    const last = inserted.at(-1);
    if (last) editor.setTextCursorPosition(last, "end");
  });
};

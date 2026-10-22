import { getDefaultReactSlashMenuItems } from "@blocknote/react";

import { getColumnSlashMenuItems } from "./columns/columnSlashMenuItems";
import { insertBlockWithoutText } from "./editorBlockInsertion";
import type { NoteBlockEditor } from "./noteEditorSchema";
import { isSlashCommandKey, type SlashCommand } from "./slashMenuModel";

/** BlockNote's slash commands that notes offer (see `slashCommands`), plus columns. */
export const getDefaultEditorSlashMenuItems = (editor: NoteBlockEditor): SlashCommand[] => {
  // BlockNote's items carry a `key` at runtime that its React type leaves out.
  const defaultItems = getDefaultReactSlashMenuItems(editor).flatMap((item): SlashCommand[] => {
    const { key } = item as { key?: string };
    if (!key || !isSlashCommandKey(key)) return [];
    // BlockNote leaves the caret on a divider inserted last, where typing does nothing.
    if (key === "divider") {
      const onItemClick = () => insertBlockWithoutText(editor, { type: "divider" });
      return [{ ...item, key, onItemClick }];
    }
    return [{ ...item, key }];
  });
  // The menu orders commands by section and rank, so columns can go last.
  return [...defaultItems, ...getColumnSlashMenuItems(editor)];
};

import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { Columns2Icon, Columns3Icon } from "lucide-react";

import type { NoteBlockEditor, NotePartialBlock } from "../noteEditorSchema";
import type { SlashCommand } from "../slashMenuModel";

/** A column list of `count` columns, each holding an empty paragraph. */
const emptyColumns = (count: number): NotePartialBlock => ({
  type: "columnList",
  children: Array.from({ length: count }, () => ({
    type: "column",
    children: [{ type: "paragraph" }],
  })),
});

/**
 * Inserts a column list the way a slash command inserts a block (in place of
 * the caret's block when that's empty, otherwise below it), with the caret in
 * its first column.
 */
const insertColumns = (editor: NoteBlockEditor, count: number) =>
  editor.transact(() => {
    const list = insertOrUpdateBlockForSlashMenu(editor, emptyColumns(count));
    const first = list.children[0]?.children[0];
    if (first) editor.setTextCursorPosition(first, "start");
  });

const aliases = ["columns", "row", "split"];

/** The slash commands that lay out two or three columns. */
export const getColumnSlashMenuItems = (editor: NoteBlockEditor): SlashCommand[] => [
  {
    key: "columns_2",
    title: "Two Columns",
    subtext: "Two columns side by side",
    aliases,
    group: "Basic blocks",
    icon: <Columns2Icon size={18} aria-hidden />,
    onItemClick: () => insertColumns(editor, 2),
  },
  {
    key: "columns_3",
    title: "Three Columns",
    subtext: "Three columns side by side",
    aliases,
    group: "Basic blocks",
    icon: <Columns3Icon size={18} aria-hidden />,
    onItemClick: () => insertColumns(editor, 3),
  },
];

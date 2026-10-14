import { randomUUID } from "node:crypto";

import { z } from "zod";

import { CONVERTIBLE_TAB_KINDS } from "@loam/shared/notes/noteModel";
import { noteTableSchema } from "@loam/shared/notes/noteTableSchema";
import { StoreError } from "@loam/storage/storeError";

import { idSchema } from "../requests/params";
import { blocksSchema } from "./schemas";
import type { ToolContext, ToolDefinition } from "./tools";

/** Tools that add and remove a note's tabs and replace a page, table or embed tab's content. */
export const tabTools = ({
  call,
  define,
  fullNote,
  patchTab,
  noteId,
  baseUpdatedAt,
  withNotes,
}: ToolContext): ToolDefinition[] => [
  define(
    "loam_tabs_add",
    "Add a page, diagram, table, board or embed tab and make it active. A board shows a table's rows as cards, grouped by the select column named by the table's groupColumnId.",
    { ...noteId, title: z.string(), kind: z.enum(CONVERTIBLE_TAB_KINDS), baseUpdatedAt },
    async (input) => {
      const note = await fullNote(input.noteId);
      const id = randomUUID();
      const saved = await call("notes.save", {
        noteId: input.noteId,
        baseUpdatedAt: input.baseUpdatedAt,
        patch: {
          tabs: [...note.tabs, { id, title: input.title, kind: input.kind }],
          activeTabId: id,
          blocksByTab: { ...note.blocksByTab, [id]: [] },
          ...(input.kind === "graph"
            ? {
                graphsByTab: {
                  ...note.graphsByTab,
                  [id]: { enabled: true, nodes: [], edges: [] },
                },
              }
            : {}),
          ...(input.kind === "table" || input.kind === "board"
            ? { tablesByTab: { ...note.tablesByTab, [id]: { columns: [], rows: [] } } }
            : {}),
          ...(input.kind === "embed"
            ? { embedsByTab: { ...note.embedsByTab, [id]: { url: "" } } }
            : {}),
        },
      });
      return { tabId: id, ...saved };
    },
    withNotes,
  ),
  define(
    "loam_tabs_remove",
    "Delete a tab and its content, retaining at least one tab.",
    { ...noteId, tabId: idSchema, baseUpdatedAt },
    async (input) => {
      const note = await fullNote(input.noteId);
      const tabs = note.tabs.filter((tab) => tab.id !== input.tabId);
      if (tabs.length === note.tabs.length || tabs.length === 0)
        throw new StoreError(
          "A note needs at least one tab; choose an existing tab.",
          "VALIDATION_ERROR",
          400,
        );
      const without = <T>(map: Record<string, T> | undefined) =>
        Object.fromEntries(Object.entries(map ?? {}).filter(([key]) => key !== input.tabId));
      return call("notes.save", {
        noteId: input.noteId,
        baseUpdatedAt: input.baseUpdatedAt,
        patch: {
          tabs,
          activeTabId: note.activeTabId === input.tabId ? tabs[0]!.id : note.activeTabId,
          blocksByTab: without(note.blocksByTab),
          graphsByTab: without(note.graphsByTab),
          tablesByTab: without(note.tablesByTab),
          textsByTab: without(note.textsByTab),
          embedsByTab: without(note.embedsByTab),
          filesByTab: without(note.filesByTab),
        },
      });
    },
    { destructive: true, flushFirst: true },
  ),
  define(
    "loam_blocks_set",
    "Replace blocks in one page tab while preserving all other tabs. Use block JSON for every rich editor feature.",
    { ...noteId, tabId: idSchema, blocks: blocksSchema, baseUpdatedAt },
    (input) => patchTab(input.noteId, input.tabId, input.baseUpdatedAt, "page", input.blocks),
    withNotes,
  ),
  define(
    "loam_tables_set",
    "Replace one table or board, including typed columns, select options, widths, ordered rows, cells and heading connections.",
    { ...noteId, tabId: idSchema, table: noteTableSchema, baseUpdatedAt },
    (input) => patchTab(input.noteId, input.tabId, input.baseUpdatedAt, "table", input.table),
    withNotes,
  ),
  define(
    "loam_embeds_set",
    "Set what one embed tab shows: an https web page address, or an image as page blocks store one.",
    { ...noteId, tabId: idSchema, url: z.string().max(4096), baseUpdatedAt },
    (input) =>
      patchTab(input.noteId, input.tabId, input.baseUpdatedAt, "embed", { url: input.url }),
    withNotes,
  ),
];

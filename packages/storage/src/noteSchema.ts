import { z } from "zod";

import {
  tabKindOf,
  LEGACY_BACKLINKS_TAB_KIND,
  LEGACY_PAGE_TAB_KIND,
  MAX_NOTE_MARKDOWN_LENGTH,
  NOTE_TAB_KINDS,
  type NoteTab,
} from "@loam/shared/notes/noteModel";

/**
 * The shape a stored note must have. The store checks it on every write: a
 * save, a new or restored note, an import and a change from another computer,
 * so a note that reaches the database can always be read and shown.
 *
 * It checks the structure the app walks when it reads a note (tabs, the
 * blocks, graph and table of each tab, the video) and keeps every other field
 * as it came, so notes written by a newer or older version are never trimmed.
 * What the editor adds on top, such as length limits on node titles, is the
 * editor's own business; AI clients get the stricter schemas in the MCP tools.
 */

const MAX_NOTE_TITLE_LENGTH = 500;

const idSchema = z.string().min(1);

const titleSchema = z
  .string()
  .transform((title) => Array.from(title.trim()).slice(0, MAX_NOTE_TITLE_LENGTH).join(""));

/**
 * A note's tabs without backlinks tabs, which hold nothing. A note left with
 * no tab keeps an empty page in the first tab's place, so links to that tab
 * and an `activeTabId` naming it still find one.
 */
export const withoutBacklinksTabs = <Tab extends { id: string; kind?: string | null }>(
  tabs: readonly Tab[],
): (Tab | NoteTab)[] => {
  const kept = tabs.filter((tab) => tab.kind !== LEGACY_BACKLINKS_TAB_KIND);
  if (kept.length > 0 || tabs.length === 0) return kept;
  return [{ id: tabs[0]!.id, title: "Page", kind: "page" }];
};

const tabsSchema = z
  .array(
    z.looseObject({
      id: idSchema,
      title: z.unknown(),
      // Older versions write backlinks tabs, and Text tabs as "markdown", and sync them here.
      kind: z.enum([...NOTE_TAB_KINDS, LEGACY_PAGE_TAB_KIND, LEGACY_BACKLINKS_TAB_KIND]).nullish(),
    }),
  )
  .min(1, "a note needs a tab")
  .transform((tabs) =>
    withoutBacklinksTabs(tabs).map((tab, position): NoteTab => ({
      id: tab.id,
      title: typeof tab.title === "string" ? tab.title : "",
      kind: tabKindOf(tab),
      position,
    })),
  )
  .refine(
    (tabs) => new Set(tabs.map((tab) => tab.id)).size === tabs.length,
    "two tabs share an id",
  );

const graphSchema = z.looseObject({
  nodes: z.array(
    z.looseObject({ id: idSchema, position: z.looseObject({ x: z.number(), y: z.number() }) }),
  ),
  edges: z.array(z.looseObject({ id: idSchema, source: z.string(), target: z.string() })),
});

const tableSchema = z.looseObject({
  columns: z.array(z.looseObject({ id: idSchema, type: z.string() })),
  rows: z.array(z.looseObject({ id: idSchema, cells: z.record(z.string(), z.unknown()) })),
});

const fileSchema = z.looseObject({
  name: z.string(),
  source: z.discriminatedUnion("kind", [
    z.looseObject({ kind: z.literal("imported"), fileName: z.string().min(1) }),
    z.looseObject({ kind: z.literal("text"), text: z.string().max(MAX_NOTE_MARKDOWN_LENGTH) }),
    z.looseObject({
      kind: z.literal("referenced"),
      path: z.string().min(1),
      computerId: z.string().min(1),
    }),
  ]),
});

const videoSchema = z.looseObject({ url: z.string(), videoId: z.string() });

/**
 * The fields a save may send; each is checked only when present. `null`
 * removes the video or the legacy single graph.
 */
export const storedNotePatchSchema = z.object({
  title: titleSchema.optional(),
  tabs: tabsSchema.optional(),
  activeTabId: z.string().optional(),
  blocksByTab: z.record(z.string(), z.array(z.unknown())).optional(),
  graphsByTab: z.record(z.string(), graphSchema).optional(),
  tablesByTab: z.record(z.string(), tableSchema).optional(),
  textsByTab: z.record(z.string(), z.string()).optional(),
  embedsByTab: z.record(z.string(), z.looseObject({ url: z.string() })).optional(),
  filesByTab: z.record(z.string(), fileSchema).optional(),
  video: videoSchema.nullish(),
  graph: graphSchema.nullish(),
});

import { z } from "zod";

import { LOAM_APP_ORIGIN } from "@loam/shared/bridge/loamBridge";
import {
  LEGACY_BACKLINKS_TAB_KIND,
  tabKindOf,
  type NoteContent,
  type NoteDocument,
  type NotePatch,
  type NoteTab,
} from "@loam/shared/notes/noteModel";
import { removeBrokenHeadingConnections } from "@loam/shared/notes/headingConnections";
import { readNoteHrefNoteId } from "@loam/shared/notes/noteLinks";
import { isRecord } from "@loam/shared/utils/isRecord";
import { stableJsonStringify } from "@loam/shared/utils/stableJson";
import { UUID_PATTERN } from "@loam/shared/utils/uuid";

import type { StorageNoteSearchFields, StorageWrite } from "./adapter";
import { flattenLegacyNoteLinks } from "./legacyNoteLinks";
import { upgradeTextTabs } from "./legacyTextTabs";
import { storedNotePatchSchema, withoutBacklinksTabs } from "./noteSchema";
import { extractTabText } from "./search";
import { invalidRequest, StoreError } from "./storeError";

/**
 * A note's place in the library plus what lists, search and backlinks read.
 * Its content is a separate record, so listing the library never parses bodies.
 */
export type NoteRow = StorageNoteSearchFields & {
  id: string;
  folderId: string | null;
  /** Set only on notes outside folders; rows saved before projects have none. */
  projectId?: string;
  position: number;
  updatedAt: string;
  activeTabId: string;
  video: NoteContent["video"] | null;
  linkedNoteIds: string[];
};

/** A note's content as stored; the title lives in its row. */
export type StoredContent = Omit<NoteContent, "title">;

/** The row and content of a note, as stored. */
export type StoredNote = { row: NoteRow; content: StoredContent };

/** A deleted note in Trash: everything it held, to put it back. */
export type TrashedNote = { note: NoteDocument; deletedAt: number };

export const readId = (value: unknown, what: string) => {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw invalidRequest(`${what} id`);
  return value;
};

export const readFolderId = (value: unknown) => (value == null ? null : readId(value, "folder"));

export const readProjectId = (value: unknown) =>
  value == null ? undefined : readId(value, "project");

const invalidNote = (detail: string) =>
  new StoreError(`Invalid note: ${detail}.`, "VALIDATION_ERROR", 400);

/** Where a note failed the stored-note schema, in words a log or an AI client can act on. */
const describeIssue = (issue: z.core.$ZodIssue) =>
  issue.code === "custom" || (issue.code === "too_small" && issue.path.join(".") === "tabs")
    ? issue.message
    : `${issue.path.join(".") || "the note"} is not valid`;

/** The tabs `value` names, with the kinds an older version may have saved. */
const rawTabsIn = (value: unknown) =>
  isRecord(value) && Array.isArray(value.tabs)
    ? value.tabs.flatMap((tab) =>
        isRecord(tab) && typeof tab.id === "string"
          ? [{ id: tab.id, kind: typeof tab.kind === "string" ? tab.kind : null }]
          : [],
      )
    : [];

/**
 * Checks the fields a save sends. Only fields present are read, so a patch
 * changes just what it names. Text tabs it names from an older version
 * become graph tabs, and a patch naming graphs gets one for each. Text tabs
 * are told apart from Markdown file tabs by the note's files, which are
 * `storedFiles` when the patch doesn't name them.
 */
export const readNotePatch = (
  value: unknown,
  storedFiles?: NoteContent["filesByTab"],
): NotePatch => {
  const parsed = storedNotePatchSchema.safeParse(value);
  if (!parsed.success) throw invalidNote(describeIssue(parsed.error.issues[0]!));
  // The schema checks the structure the app reads; the model's other fields are kept as they came.
  const read = parsed.data as NotePatch;
  const { graphsByTab, ...upgraded } = upgradeTextTabs(read, read.filesByTab ?? storedFiles);
  // Without graphs, the patch leaves the note's graphs as stored.
  const patch: NotePatch = read.graphsByTab ? { ...upgraded, graphsByTab } : upgraded;
  const rawTabs = rawTabsIn(value);
  const { tabs, activeTabId } = patch;
  // A note an older version sends may show a backlinks tab, which the schema drops.
  const shownBacklinks = rawTabs.some(
    (tab) => tab.id === activeTabId && tab.kind === LEGACY_BACKLINKS_TAB_KIND,
  );
  if (tabs && shownBacklinks && !tabs.some((tab) => tab.id === activeTabId))
    return { ...patch, activeTabId: tabs[0]!.id };
  return patch;
};

/** Applies a patch and checks that the result is a whole note. */
export const applyNotePatch = (content: NoteContent, patch: NotePatch): NoteContent => {
  const { video, graph, ...fields } = patch;
  const next: NoteContent = { ...content, ...fields };
  // A `null` video or graph removes it; an absent one leaves it as stored.
  if (video !== undefined) next.video = video ?? undefined;
  if (graph !== undefined) next.graph = graph ?? undefined;
  for (const key of ["video", "graph"] as const) if (next[key] === undefined) delete next[key];
  if (!next.tabs.some((tab) => tab.id === next.activeTabId))
    throw invalidNote("the active tab is not one of its tabs");
  // Every tab has blocks, and blocks of removed tabs go.
  next.blocksByTab = Object.fromEntries(
    next.tabs.map((tab) => [tab.id, next.blocksByTab[tab.id] ?? []]),
  );
  return next;
};

/** A complete note from untrusted input, as `createNote` and imports receive it. */
export const readNoteContent = (value: unknown): NoteContent => {
  // A whole note's graphs are all it has, so each Text tab without one gets one.
  const patch = readNotePatch(
    isRecord(value) ? { ...value, graphsByTab: value.graphsByTab ?? {} } : value,
  );
  if (!patch.tabs) throw invalidNote("a note needs a tab");
  const empty = { title: "", tabs: [], blocksByTab: {}, activeTabId: "" };
  return applyNotePatch({ ...empty, graphsByTab: {}, tablesByTab: {} }, patch);
};

export const splitTitle = ({ title, ...content }: NoteContent) => ({ title, content });

/** A block's inline content: its text, or every cell of a table. */
const inlineContentOf = (block: Record<string, unknown>): unknown[] => {
  const { content } = block;
  if (Array.isArray(content)) return content;
  if (!isRecord(content) || !Array.isArray(content.rows)) return [];
  return content.rows.flatMap((row) =>
    isRecord(row) && Array.isArray(row.cells)
      ? // A cell is an inline content array or a `tableCell` object wrapping one.
        row.cells.flatMap((cell) => {
          const items = isRecord(cell) ? cell.content : cell;
          return Array.isArray(items) ? items : [];
        })
      : [],
  );
};

/** Calls `visit` with the href of every link in the blocks and their nested blocks. */
const forEachLinkHref = (blocks: unknown, visit: (href: string) => void): void => {
  if (!Array.isArray(blocks)) return;
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    for (const item of inlineContentOf(block))
      if (isRecord(item) && item.type === "link" && typeof item.href === "string") visit(item.href);
    forEachLinkHref(block.children, visit);
  }
};

/** A Markdown link's destination, as `[text](href)` or `[text](<href>)` writes it. */
const MARKDOWN_LINK = /\]\(\s*<?([^\s)>]+)>?/g;

/** The notes this one links to, as lowercase ids, which is how backlinks look them up. */
const collectLinkedNoteIds = (noteId: string, content: NoteContent) => {
  const ids = new Set<string>();
  const visit = (href: string) => {
    // A link holding the packaged window's full URL opens its note too.
    const id = readNoteHrefNoteId(href, LOAM_APP_ORIGIN)?.toLowerCase();
    if (id && UUID_PATTERN.test(id) && id !== noteId.toLowerCase()) ids.add(id);
  };
  for (const blocks of Object.values(content.blocksByTab)) forEachLinkHref(blocks, visit);
  const markdownTexts = Object.values(content.filesByTab ?? {}).flatMap(({ source }) =>
    source.kind === "text" ? [source.text] : [],
  );
  for (const text of [...Object.values(content.textsByTab ?? {}), ...markdownTexts])
    for (const match of text.matchAll(MARKDOWN_LINK)) visit(match[1]!);
  return [...ids].sort();
};

const extractNoteText = (content: NoteContent) =>
  content.tabs
    .map((tab) => extractTabText(content, tab))
    .filter(Boolean)
    .join("\n");

/**
 * Where a note sits: in a folder, or outside folders in a project or at the
 * library's top level. A folder decides its notes' project.
 */
export type NotePlace = { folderId: string | null; projectId?: string };

/** A note's place and its position there. */
export type NotePlacement = NotePlace & { position: number };

/** Notes are numbered within a folder, or outside folders within a project or the top level. */
export const placeKey = ({ folderId, projectId }: NotePlace) =>
  folderId ? `folder:${folderId}` : `project:${projectId ?? ""}`;

export const samePlace = (left: NotePlace, right: NotePlace) => placeKey(left) === placeKey(right);

/** A place as stored: a note in a folder has no project of its own. */
export const toPlacement = ({ folderId, projectId, position }: NotePlacement): NotePlacement =>
  !folderId && projectId ? { folderId, projectId, position } : { folderId, position };

export const buildNoteRow = (
  id: string,
  content: NoteContent,
  placement: NotePlacement,
  updatedAt: string,
): NoteRow => ({
  id,
  title: content.title,
  text: extractNoteText(content),
  ...toPlacement(placement),
  updatedAt,
  activeTabId: content.activeTabId,
  video: content.video ?? null,
  linkedNoteIds: collectLinkedNoteIds(id, content),
});

/** A row moved to `placement`. */
export const placeRow = (
  { projectId: _former, ...row }: NoteRow,
  placement: NotePlacement,
): NoteRow => ({
  ...row,
  ...toPlacement(placement),
});

/** The list form the sidebar loads; the editor reads the full note separately. */
export const toNoteSummary = (row: NoteRow): NoteDocument => ({
  contentState: "summary",
  id: row.id,
  title: row.title,
  updatedAt: row.updatedAt,
  tabs: [],
  blocksByTab: {},
  activeTabId: row.activeTabId,
  video: row.video ?? undefined,
  graphsByTab: {},
  tablesByTab: {},
  folderId: row.folderId ?? undefined,
  projectId: row.projectId,
  position: row.position,
});

/**
 * Stored content as the app reads it, each tab with its current kind. Notes
 * and versions stored by older versions may hold Text tabs, which open as
 * graphs holding their Markdown, and backlinks tabs, which go; the first tab
 * left shows if one of them did.
 */
export const readStoredContent = <Content extends StoredContent>(content: Content): Content => {
  const upgraded = upgradeTextTabs(content);
  const tabs = withoutBacklinksTabs(upgraded.tabs).map((tab): NoteTab => ({
    ...tab,
    kind: tabKindOf(tab),
  }));
  const activeTabId = tabs.some((tab) => tab.id === content.activeTabId)
    ? content.activeTabId
    : tabs[0]!.id;
  return { ...upgraded, tabs, activeTabId };
};

export const toNoteContent = (row: NoteRow, content: StoredContent): NoteContent => ({
  ...readStoredContent(content),
  title: row.title,
});

export const toFullNote = (row: NoteRow, content: StoredContent): NoteDocument => {
  const read = toNoteContent(row, content);
  const note: NoteDocument = {
    ...read,
    contentState: "full",
    id: row.id,
    updatedAt: row.updatedAt,
    blocksByTab: Object.fromEntries(
      read.tabs.map((tab) => [tab.id, flattenLegacyNoteLinks(content.blocksByTab[tab.id] ?? [])]),
    ),
    graphsByTab: read.graphsByTab ?? {},
    tablesByTab: content.tablesByTab ?? {},
    folderId: row.folderId ?? undefined,
    projectId: row.projectId,
    position: row.position,
  };
  return removeBrokenHeadingConnections(note);
};

export const sortNoteSummaries = (notes: NoteDocument[]) =>
  [...notes].sort((left, right) => {
    const folderOrder = (left.folderId ?? "").localeCompare(right.folderId ?? "");
    if (folderOrder !== 0) return folderOrder;
    const projectOrder = (left.projectId ?? "").localeCompare(right.projectId ?? "");
    if (projectOrder !== 0) return projectOrder;
    const positionOrder = (left.position ?? 0) - (right.position ?? 0);
    if (positionOrder !== 0) return positionOrder;
    return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
  });

/** Whether two versions of a note say the same, whatever order their keys are in. */
export const sameContent = (left: NoteContent | null, right: NoteContent | null) =>
  stableJsonStringify(left) === stableJsonStringify(right);

/** The position after the last note in `place`. */
export const nextPosition = (rows: Iterable<NoteRow>, place: NotePlace) => {
  let next = 0;
  for (const row of rows) if (samePlace(row, place)) next = Math.max(next, row.position + 1);
  return next;
};

/** The writes that store a note: its row, its content, and no copy left in Trash. */
export const noteWrites = (row: NoteRow, content: NoteContent): StorageWrite[] => [
  { type: "put", collection: "notes", id: row.id, value: row },
  { type: "put", collection: "documents", id: row.id, value: splitTitle(content).content },
  { type: "delete", collection: "trash", id: row.id },
];

/** The writes that move a note to Trash. */
export const trashWrites = (note: StoredNote, deletedAt: number): StorageWrite[] => [
  {
    type: "put",
    collection: "trash",
    id: note.row.id,
    value: { note: toFullNote(note.row, note.content), deletedAt } satisfies TrashedNote,
  },
  { type: "delete", collection: "notes", id: note.row.id },
  { type: "delete", collection: "documents", id: note.row.id },
];

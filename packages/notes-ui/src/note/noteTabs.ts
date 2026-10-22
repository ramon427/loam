import { createDefaultBlocks } from "../editor/blocknote/editorTabTemplates";
import { inlineText, type NotePartialBlock } from "../editor/noteEditorSchema";
import { applySortableItemMove } from "../lib/moveItemBefore";
import { createUuid } from "@loam/shared/utils/uuid";

import {
  disconnectNoteHeadings,
  listNoteHeadingConnectionOptions,
  listNoteHeadingConnectionTargets,
} from "../editor/noteHeadingConnections";
import { createNoteGraph } from "../graph/noteGraph";
import { createNoteTable } from "../table/noteTable";
import { fileTitleOf } from "../workspace/noteDocuments";
import type { NoteDocument } from "../workspace/types";
import {
  isFileTabKind,
  tabKindOf,
  type ConvertibleTabKind,
  type FileTabKind,
  type NoteFile,
  type NoteTab,
} from "@loam/shared/notes/noteModel";
import type { NoteContentPatch } from "../workspace/NotesWorkspace";
import { createNoteBoard } from "../board/noteBoard";
import { convertTabContent, type ParseMarkdown, type TabContent } from "./tabConversions";
import { defaultTabTitle, isDefaultTabTitle } from "./tabKinds";

/*
 * A note's tabs as pure functions of the note. Each change returns the patch
 * to apply with `updateNote`, or null when there is nothing to change.
 */

export const MAX_TABS = 24;
export const MAX_TAB_TITLE_LENGTH = 80;

/** The tab a note shows. The store keeps `activeTabId` one of the note's tabs. */
export const activeTabOf = (note: NoteDocument) =>
  note.tabs.find((tab) => tab.id === note.activeTabId) ?? note.tabs[0]!;

const without = <T>(record: Record<string, T> | undefined, key: string) =>
  Object.fromEntries(Object.entries(record ?? {}).filter(([id]) => id !== key));

const renumber = (tabs: readonly NoteTab[]) => tabs.map((tab, position) => ({ ...tab, position }));

/** The headings a page tab holds, which graph nodes and table rows can link to. */
const headingIdsIn = (note: NoteDocument, tabId: string) =>
  listNoteHeadingConnectionOptions(note).flatMap((heading) =>
    heading.tabId === tabId ? [heading.headingBlockId] : [],
  );

/** What a new tab of `kind` starts with. */
const newTabContent = (note: NoteDocument, kind: ConvertibleTabKind): TabContent => {
  if (kind === "graph") return { kind, graph: createNoteGraph(note) };
  if (kind === "table") return { kind, table: createNoteTable(note) };
  if (kind === "embed") return { kind, embed: { url: "" } };
  if (kind === "board") return { kind, table: createNoteBoard() };
  return { kind, blocks: createDefaultBlocks() };
};

/** A note's content maps with `content` as the tab's own entry. */
const withTabContent = (note: NoteDocument, tabId: string, content: TabContent) => ({
  blocksByTab: { ...note.blocksByTab, [tabId]: content.kind === "page" ? content.blocks : [] },
  graphsByTab: {
    ...without(note.graphsByTab, tabId),
    ...(content.kind === "graph" ? { [tabId]: content.graph } : {}),
  },
  tablesByTab: {
    ...without(note.tablesByTab, tabId),
    ...(content.kind === "table" || content.kind === "board" ? { [tabId]: content.table } : {}),
  },
  // A former Text tab's Markdown goes with the content its graph took over.
  textsByTab: without(note.textsByTab, tabId),
  embedsByTab: {
    ...without(note.embedsByTab, tabId),
    ...(content.kind === "embed" ? { [tabId]: content.embed } : {}),
  },
  filesByTab: {
    ...without(note.filesByTab, tabId),
    ...("file" in content ? { [tabId]: content.file } : {}),
  },
});

/** `patch`, also dropping links to `headingIds` from the graphs and tables it leaves. */
const withHeadingsDisconnected = (
  note: NoteDocument,
  patch: NoteContentPatch,
  headingIds: readonly string[],
): NoteContentPatch =>
  headingIds.length > 0
    ? { ...patch, ...disconnectNoteHeadings({ ...note, ...patch }, headingIds) }
    : patch;

/** A new tab at the end, holding `content` and shown at once. */
const addTabHolding = (
  note: NoteDocument,
  content: TabContent,
  title = defaultTabTitle(
    content.kind,
    note.tabs.map((candidate) => candidate.title),
  ),
): NoteContentPatch | null => {
  if (note.tabs.length >= MAX_TABS) return null;
  const tab: NoteTab = { id: createUuid(), title, kind: content.kind, position: note.tabs.length };
  return {
    tabs: [...note.tabs, tab],
    activeTabId: tab.id,
    ...withTabContent(note, tab.id, content),
  };
};

/** A new tab of `kind` at the end, shown at once. */
export const addTab = (note: NoteDocument, kind: ConvertibleTabKind) =>
  addTabHolding(note, newTabContent(note, kind));

/** A new tab showing `file`, named after it, at the end and shown at once. */
export const addFileTab = (note: NoteDocument, kind: FileTabKind, file: NoteFile) =>
  addTabHolding(note, { kind, file }, fileTitleOf(file));

export const renameTab = (note: NoteDocument, tabId: string, title: string): NoteContentPatch => {
  const trimmed = title.slice(0, MAX_TAB_TITLE_LENGTH).trim();
  return {
    tabs: note.tabs.map((tab) =>
      tab.id === tabId ? { ...tab, title: trimmed || "Untitled" } : tab,
    ),
  };
};

/**
 * Removes a tab and what it holds. Headings in a removed page tab stop being
 * linked from graph nodes and table rows. The first tab is shown if the
 * removed one was.
 */
export const deleteTab = (note: NoteDocument, tabId: string): NoteContentPatch | null => {
  const tab = note.tabs.find((candidate) => candidate.id === tabId);
  if (!tab || note.tabs.length <= 1) return null;
  const tabs = renumber(note.tabs.filter((candidate) => candidate.id !== tabId));
  const patch = {
    tabs,
    blocksByTab: without(note.blocksByTab, tabId),
    graphsByTab: without(note.graphsByTab, tabId),
    tablesByTab: without(note.tablesByTab, tabId),
    textsByTab: without(note.textsByTab, tabId),
    embedsByTab: without(note.embedsByTab, tabId),
    filesByTab: without(note.filesByTab, tabId),
    activeTabId: note.activeTabId === tabId ? tabs[0]!.id : note.activeTabId,
  };
  const removedHeadings = tabKindOf(tab) === "page" ? headingIdsIn(note, tabId) : [];
  return withHeadingsDisconnected(note, patch, removedHeadings);
};

/** Moves a dragged tab before or after another. */
export const moveTab = (
  note: NoteDocument,
  sourceId: string,
  targetId: string,
  half: "before" | "after",
): NoteContentPatch | null => {
  const moved = applySortableItemMove({
    items: note.tabs,
    sourceId,
    targetId,
    half,
    getId: (tab) => tab.id,
  });
  return moved ? { tabs: renumber(moved) } : null;
};

/**
 * Turns a tab into another kind, carrying its content over as
 * `convertTabContent` can, and shows it. Headings of a page tab go with the
 * page, and so do the links to them.
 */
export const changeTabKind = (
  note: NoteDocument,
  tabId: string,
  kind: ConvertibleTabKind,
  parseMarkdown: ParseMarkdown | null = null,
): NoteContentPatch | null => {
  const tab = note.tabs.find((candidate) => candidate.id === tabId);
  if (!tab || tabKindOf(tab) === kind || isFileTabKind(tabKindOf(tab))) return null;
  // A title the old kind gave the tab follows the kind; one the user chose stays.
  const others = note.tabs.flatMap((candidate) =>
    candidate.id === tabId ? [] : [candidate.title],
  );
  const title = isDefaultTabTitle(tabKindOf(tab), tab.title)
    ? defaultTabTitle(kind, others)
    : tab.title;
  const patch = {
    tabs: note.tabs.map((candidate) =>
      candidate.id === tabId ? { ...candidate, kind, title } : candidate,
    ),
    activeTabId: tabId,
    ...withTabContent(
      note,
      tabId,
      convertTabContent(note, tab, kind, parseMarkdown) ?? newTabContent(note, kind),
    ),
  };
  const removedHeadings = tabKindOf(tab) === "page" ? headingIdsIn(note, tabId) : [];
  return withHeadingsDisconnected(note, patch, removedHeadings);
};

/** Whether blocks hold anything: some text, or a block other than a paragraph. */
const blocksHaveContent = (blocks: readonly NotePartialBlock[]): boolean =>
  blocks.some(
    (block) =>
      inlineText(block.content).trim() !== "" ||
      (block.type !== undefined && block.type !== "paragraph") ||
      blocksHaveContent(block.children ?? []),
  );

/** Whether changing a tab's kind would throw away something the user made. */
export const tabHasContent = (note: NoteDocument, tab: NoteTab) => {
  const kind = tabKindOf(tab);
  if (kind === "graph") return Boolean(note.graphsByTab?.[tab.id]);
  if (kind === "table" || kind === "board") return Boolean(note.tablesByTab?.[tab.id]);
  if (kind === "embed") return Boolean(note.embedsByTab?.[tab.id]?.url);
  if (isFileTabKind(kind)) return Boolean(note.filesByTab?.[tab.id]);
  return blocksHaveContent(note.blocksByTab[tab.id] ?? []);
};

const plural = (count: number, singular: string, plurals: string) =>
  `${count} ${count === 1 ? singular : plurals}`;

/**
 * What removing a tab, or changing its kind, does to heading links, as a
 * sentence for the confirmation; null when it touches none.
 */
export const describeTabRemoval = (note: NoteDocument, tab: NoteTab): string | null => {
  const targets = listNoteHeadingConnectionTargets(note);
  if (tabKindOf(tab) === "page") {
    const headings = new Set(headingIdsIn(note, tab.id));
    const affected = targets.filter((target) =>
      target.headingBlockIds.some((id) => headings.has(id)),
    );
    const links = affected.reduce(
      (count, target) => count + target.headingBlockIds.filter((id) => headings.has(id)).length,
      0,
    );
    if (links === 0) return null;
    return `This will disconnect ${plural(links, "heading connection", "heading connections")} from ${plural(affected.length, "graph or table target", "graph or table targets")}.`;
  }
  const owned = targets.filter(
    (target) => target.tabId === tab.id && target.headingBlockIds.length > 0,
  );
  const links = owned.reduce((count, target) => count + target.headingBlockIds.length, 0);
  if (links === 0) return null;
  return `This will remove ${plural(links, "heading connection", "heading connections")} owned by ${plural(owned.length, "connected target", "connected targets")} in this tab.`;
};

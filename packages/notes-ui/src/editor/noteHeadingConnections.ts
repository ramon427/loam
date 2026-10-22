import {
  MAX_NOTE_HEADING_CONNECTIONS_PER_TARGET,
  mapHeadingTargets,
  normalizeNoteHeadingBlockIds,
  type HeadingTarget,
} from "@loam/shared/notes/headingConnections";
import { isRecord } from "@loam/shared/utils/isRecord";

import type { NoteDocument } from "../workspace/types";
import {
  tabKindOf,
  tabTitleOf,
  type NoteTable,
  type NoteTableRow,
} from "@loam/shared/notes/noteModel";
import { inlineText, type NotePartialBlock } from "./noteEditorSchema";

/** A graph node, table row or table column, as the connection menus list it. */
export type NoteHeadingConnectionTarget = HeadingTarget & {
  /** Unique within the note. */
  id: string;
  tabTitle: string;
  title: string;
  headingBlockIds: string[];
};

/** What a target is, as the connection menus name it. */
export const headingTargetKindLabel = (kind: HeadingTarget["kind"]) => {
  if (kind === "graph-node") return "Graph node";
  if (kind === "table-row") return "Table row";
  return "Table column";
};

/** A heading in a page tab that targets can connect to, as the connection menus list it. */
export type NoteHeadingConnectionOption = {
  headingBlockId: string;
  tabId: string;
  tabTitle: string;
  title: string;
  level: 1 | 2 | 3;
  isToggleable: boolean;
  connectionCount: number;
};

/** A heading's connection to one target, kept so undo can bring it back. */
export type NoteHeadingConnectionSnapshot = HeadingTarget & { headingBlockId: string };

type HeadingBlock = NotePartialBlock & { id: string; type: "heading" };

export const isNoteHeadingBlock = (block: unknown): block is HeadingBlock =>
  isRecord(block) && block.type === "heading" && typeof block.id === "string" && block.id !== "";

const listHeadingBlocks = (blocks: readonly NotePartialBlock[]): HeadingBlock[] =>
  blocks.flatMap((block) => [
    ...(isNoteHeadingBlock(block) ? [block] : []),
    ...listHeadingBlocks(block.children ?? []),
  ]);

const rowTitle = (table: NoteTable, row: NoteTableRow, index: number) => {
  const firstColumn = table.columns[0];
  const value = firstColumn ? row.cells[firstColumn.id] : null;
  return (value === null || value === undefined ? "" : String(value).trim()) || `Row ${index + 1}`;
};

const isTarget = (left: HeadingTarget, right: HeadingTarget) =>
  left.kind === right.kind && left.tabId === right.tabId && left.targetId === right.targetId;

export const listNoteHeadingConnectionTargets = (
  note: NoteDocument,
): NoteHeadingConnectionTarget[] => {
  const tabTitles = new Map(note.tabs.map((tab) => [tab.id, tabTitleOf(tab)]));
  const target = (ref: HeadingTarget, title: string, headingBlockIds: unknown) => ({
    ...ref,
    id: `${ref.kind}:${ref.tabId}:${ref.targetId}`,
    tabTitle: tabTitles.get(ref.tabId) ?? (ref.kind === "graph-node" ? "Graph" : "Table"),
    title,
    headingBlockIds: normalizeNoteHeadingBlockIds(headingBlockIds) ?? [],
  });
  return [
    ...Object.entries(note.graphsByTab ?? {}).flatMap(([tabId, graph]) =>
      graph.nodes.map((node) =>
        target(
          { kind: "graph-node", tabId, targetId: node.id },
          node.title.trim() || "Untitled node",
          node.headingBlockIds,
        ),
      ),
    ),
    ...Object.entries(note.tablesByTab ?? {}).flatMap(([tabId, table]) => [
      ...table.columns.map((column) =>
        target(
          { kind: "table-column", tabId, targetId: column.id },
          column.title.trim() || "Untitled column",
          column.headingBlockIds,
        ),
      ),
      ...table.rows.map((row, index) =>
        target(
          { kind: "table-row", tabId, targetId: row.id },
          rowTitle(table, row, index),
          row.headingBlockIds,
        ),
      ),
    ]),
  ];
};

export const listNoteHeadingConnectionOptions = (
  note: NoteDocument,
): NoteHeadingConnectionOption[] => {
  const connectionCounts = new Map<string, number>();
  for (const target of listNoteHeadingConnectionTargets(note))
    for (const id of target.headingBlockIds)
      connectionCounts.set(id, (connectionCounts.get(id) ?? 0) + 1);

  const seen = new Set<string>();
  return note.tabs.flatMap((tab) => {
    if (tabKindOf(tab) !== "page") return [];
    return listHeadingBlocks(note.blocksByTab[tab.id] ?? []).flatMap((block) => {
      if (seen.has(block.id)) return [];
      seen.add(block.id);
      const props = (block.props ?? {}) as { level?: unknown; isToggleable?: unknown };
      return [
        {
          headingBlockId: block.id,
          tabId: tab.id,
          tabTitle: tabTitleOf(tab),
          title: inlineText(block.content).trim() || "Untitled heading",
          level: props.level === 2 || props.level === 3 ? props.level : 1,
          isToggleable: props.isToggleable === true,
          connectionCount: connectionCounts.get(block.id) ?? 0,
        },
      ];
    });
  });
};

/** Connects the target to the heading, or disconnects it if it is; a full target takes no more. */
export const toggleNoteHeadingConnection = (
  note: NoteDocument,
  target: HeadingTarget,
  headingBlockId: string,
) =>
  mapHeadingTargets(note, (ids, candidate) => {
    if (!isTarget(candidate, target)) return ids;
    if (ids.includes(headingBlockId)) return ids.filter((id) => id !== headingBlockId);
    return ids.length < MAX_NOTE_HEADING_CONNECTIONS_PER_TARGET ? [...ids, headingBlockId] : ids;
  });

/** The connections these headings have now. */
export const captureNoteHeadingConnections = (
  note: NoteDocument,
  headingBlockIds: readonly string[],
): NoteHeadingConnectionSnapshot[] =>
  listNoteHeadingConnectionTargets(note).flatMap(
    ({ kind, tabId, targetId, headingBlockIds: ids }) =>
      ids
        .filter((id) => headingBlockIds.includes(id))
        .map((headingBlockId) => ({ kind, tabId, targetId, headingBlockId })),
  );

export const disconnectNoteHeadings = (note: NoteDocument, headingBlockIds: readonly string[]) =>
  mapHeadingTargets(note, (ids) => ids.filter((id) => !headingBlockIds.includes(id)));

/** Puts captured connections back on the targets that still exist. */
export const restoreNoteHeadingConnections = (
  note: NoteDocument,
  snapshots: readonly NoteHeadingConnectionSnapshot[],
) =>
  mapHeadingTargets(note, (ids, target) => {
    const restored = snapshots
      .filter((snapshot) => isTarget(snapshot, target) && !ids.includes(snapshot.headingBlockId))
      .map((snapshot) => snapshot.headingBlockId);
    return [...ids, ...new Set(restored)].slice(0, MAX_NOTE_HEADING_CONNECTIONS_PER_TARGET);
  });

import { tabKindOf, type NoteContent } from "./noteModel";
import { isRecord } from "../utils/isRecord";

/*
 * A heading connection ties a graph node, a table row or a table column to a
 * heading in one of the note's page tabs. Each of those targets keeps the ids
 * of its headings in `headingBlockIds`. A connection holds while its id names
 * exactly one level 1, 2 or 3 heading in a page tab; the others are removed.
 */

/** The most headings one target connects to. */
export const MAX_NOTE_HEADING_CONNECTIONS_PER_TARGET = 200;

type HeadingTargetKind = "graph-node" | "table-row" | "table-column";

/** Which graph node, table row or table column, in which tab. */
export type HeadingTarget = { kind: HeadingTargetKind; tabId: string; targetId: string };

/** The note fields that hold connections. */
export type HeadingConnections = Required<Pick<NoteContent, "graphsByTab" | "tablesByTab">>;

type Connectable = { id: string; headingBlockIds?: string[] };

/** Heading ids as they are stored: trimmed, each once, at most 200; undefined when none. */
export const normalizeNoteHeadingBlockIds = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const ids = new Set<string>();
  for (const id of value) if (typeof id === "string" && id.trim()) ids.add(id.trim());
  return ids.size > 0 ? [...ids].slice(0, MAX_NOTE_HEADING_CONNECTIONS_PER_TARGET) : undefined;
};

/** Whether a target already stores exactly these ids (none: no field at all). */
const stores = (stored: unknown, ids: readonly string[]) =>
  ids.length === 0
    ? stored === undefined
    : Array.isArray(stored) &&
      stored.length === ids.length &&
      ids.every((id, index) => stored[index] === id);

/** `record` with `change` applied to each value; the same object when none changed. */
const mapValues = <T>(record: Record<string, T>, change: (value: T, key: string) => T) => {
  let changed = false;
  const next = Object.fromEntries(
    Object.entries(record).map(([key, value]) => {
      const updated = change(value, key);
      changed ||= updated !== value;
      return [key, updated];
    }),
  );
  return changed ? next : record;
};

/**
 * The note's graphs and tables after `change` gives each target its new
 * heading ids. Graphs, tables and targets it leaves alone keep their identity.
 */
export const mapHeadingTargets = (
  note: Pick<NoteContent, "graphsByTab" | "tablesByTab">,
  change: (headingBlockIds: string[], target: HeadingTarget) => readonly string[],
): HeadingConnections => {
  const update = <T extends Connectable>(targets: T[], kind: HeadingTargetKind, tabId: string) => {
    let changed = false;
    const next = targets.map((target) => {
      const current = normalizeNoteHeadingBlockIds(target.headingBlockIds) ?? [];
      const ids = change(current, { kind, tabId, targetId: target.id });
      if (stores(target.headingBlockIds, ids)) return target;
      changed = true;
      const updated = { ...target };
      if (ids.length > 0) updated.headingBlockIds = [...ids];
      else delete updated.headingBlockIds;
      return updated;
    });
    return changed ? next : targets;
  };

  // Notes stored before the store checked their structure may hold a graph or
  // table without its lists; those have nothing to connect and must still open.
  return {
    graphsByTab: mapValues(note.graphsByTab ?? {}, (graph, tabId) => {
      if (!Array.isArray(graph?.nodes)) return graph;
      const nodes = update(graph.nodes, "graph-node", tabId);
      return nodes === graph.nodes ? graph : { ...graph, nodes };
    }),
    tablesByTab: mapValues(note.tablesByTab ?? {}, (table, tabId) => {
      if (!Array.isArray(table?.columns) || !Array.isArray(table.rows)) return table;
      const columns = update(table.columns, "table-column", tabId);
      const rows = update(table.rows, "table-row", tabId);
      return columns === table.columns && rows === table.rows ? table : { ...table, columns, rows };
    }),
  };
};

const isConnectableHeading = (block: Record<string, unknown>) => {
  if (block.type !== "heading") return false;
  const level = isRecord(block.props) ? block.props.level : undefined;
  return level === undefined || level === 1 || level === 2 || level === 3;
};

/** Ids of the headings a connection may name: in a page tab, level 1 to 3, used by no other block. */
const connectableHeadingIds = ({
  tabs,
  blocksByTab,
}: Pick<NoteContent, "tabs" | "blocksByTab">) => {
  const uses = new Map<string, number>();
  const headings = new Set<string>();
  const visit = (blocks: unknown, inPageTab: boolean) => {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks) {
      if (!isRecord(block)) continue;
      const id = typeof block.id === "string" ? block.id.trim() : "";
      if (id) {
        uses.set(id, (uses.get(id) ?? 0) + 1);
        if (inPageTab && isConnectableHeading(block)) headings.add(id);
      }
      visit(block.children, inPageTab);
    }
  };
  for (const tab of tabs) visit(blocksByTab[tab.id], tabKindOf(tab) === "page");
  return new Set([...headings].filter((id) => uses.get(id) === 1));
};

/**
 * The note without connections to headings that are gone, repeated, or no
 * longer connectable; the same object when it has none of those.
 */
export const removeBrokenHeadingConnections = <
  T extends Pick<NoteContent, "tabs" | "blocksByTab" | "graphsByTab" | "tablesByTab">,
>(
  note: T,
): T => {
  const headings = connectableHeadingIds(note);
  const kept = mapHeadingTargets(note, (ids) => ids.filter((id) => headings.has(id)));
  // A note without graphs or tables maps to empty records, which changed nothing.
  const unchanged =
    kept.graphsByTab === (note.graphsByTab ?? kept.graphsByTab) &&
    kept.tablesByTab === (note.tablesByTab ?? kept.tablesByTab);
  return unchanged ? note : { ...note, ...kept };
};

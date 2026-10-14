import type {
  ConvertibleTabKind,
  FileTabKind,
  NoteEmbed,
  NoteFile,
  NoteGraph,
  NoteGraphEdge,
  NoteGraphNode,
  NoteTab,
  NoteTabKind,
  NoteTable,
} from "@loam/shared/notes/noteModel";
import { tabKindOf } from "@loam/shared/notes/noteModel";
import { createUuid } from "@loam/shared/utils/uuid";
import {
  buildNoteTableMarkdown,
  byPosition,
  formatCell,
} from "@loam/transfer/markdown/noteTableMarkdown";

import { inlineText, type NotePartialBlock } from "../editor/noteEditorSchema";
import { createNoteGraphNode } from "../graph/noteGraph";
import { computeNoteGraphTidyLayout } from "../graph/noteGraphLayout";
import { withBoardGroups } from "../board/noteBoard";
import { createNoteTableColumn, createNoteTableRow } from "../table/noteTable";
import type { NoteDocument } from "../workspace/types";

/*
 * Changing a tab's kind carries its content over. A table becomes a table in
 * a page, through Markdown. Any other change goes through an outline: a
 * page's headings, a table's rows, a graph's nodes, each with the text that
 * belongs to it.
 */

/** What a tab of each kind holds, as a patch for that tab. */
export type TabContent =
  | { kind: "page"; blocks: NotePartialBlock[] }
  | { kind: "graph"; graph: NoteGraph }
  | { kind: "table" | "board"; table: NoteTable }
  | { kind: "embed"; embed: NoteEmbed }
  | { kind: FileTabKind; file: NoteFile };

/** Markdown to page blocks, with BlockNote's parser, which loads with the page editor. */
export type ParseMarkdown = (markdown: string) => unknown[];

/** One entry of a tab's outline: a heading, row or node, and the text under it. */
type Section = { title: string; level: number; body: string[] };

const MAX_LEVEL = 3;

const blockText = (block: NotePartialBlock): string =>
  [inlineText(block.content), ...(block.children ?? []).map(blockText)]
    .filter((text) => text.trim())
    .join("\n");

const headingLevel = (block: NotePartialBlock) => {
  if (block.type !== "heading") return null;
  const level = Number((block.props as { level?: unknown } | undefined)?.level ?? 1);
  return level <= MAX_LEVEL ? level : null;
};

/** Sections from headings; text without any heading makes one section per paragraph or item. */
const outlineFromLines = (entries: ReadonlyArray<{ level: number | null; text: string }>) => {
  const filled = entries.filter((entry) => entry.text.trim());
  if (!filled.some((entry) => entry.level !== null))
    return filled.map((entry): Section => ({ title: entry.text.trim(), level: 1, body: [] }));
  const sections: Section[] = [];
  for (const entry of filled) {
    if (entry.level !== null)
      sections.push({ title: entry.text.trim(), level: entry.level, body: [] });
    else if (sections.length > 0) sections.at(-1)!.body.push(entry.text.trim());
    // Text before the first heading has no section to go in.
    else sections.push({ title: entry.text.trim(), level: 1, body: [] });
  }
  return sections;
};

const outlineOfTable = (table: NoteTable): Section[] => {
  const [first, ...others] = byPosition(table.columns);
  if (!first) return [];
  return byPosition(table.rows).flatMap((row) => {
    const title = formatCell(row.cells[first.id], first).trim();
    const body = others.flatMap((column) => {
      const value = formatCell(row.cells[column.id], column).trim();
      return value ? [`${column.title}: ${value}`] : [];
    });
    return title || body.length ? [{ title: title || "Untitled", level: 1, body }] : [];
  });
};

/** Nodes in reading order, each under the first node pointing to it. */
const outlineOfGraph = (graph: NoteGraph): Section[] => {
  const nodes = graph.nodes
    .filter((node) => node.shape !== "frame")
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const ids = new Set(nodes.map((node) => node.id));
  const parentOf = new Map<string, string>();
  for (const { source, target } of graph.edges)
    if (ids.has(source) && ids.has(target) && source !== target && !parentOf.has(target))
      parentOf.set(target, source);
  const childrenOf = new Map<string, NoteGraphNode[]>();
  for (const node of nodes) {
    const parent = parentOf.get(node.id);
    if (parent) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), node]);
  }
  const sections: Section[] = [];
  const visited = new Set<string>();
  const visit = (node: NoteGraphNode, level: number) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const body = node.notes?.trim() ? node.notes.trim().split(/\r?\n/) : [];
    sections.push({
      title: node.title.trim() || "Untitled",
      level: Math.min(level, MAX_LEVEL),
      body,
    });
    for (const child of childrenOf.get(node.id) ?? []) visit(child, level + 1);
  };
  for (const node of nodes) if (!parentOf.has(node.id)) visit(node, 1);
  // Nodes only reachable through a loop start their own branch.
  for (const node of nodes) visit(node, 1);
  return sections;
};

const outlineOf = (note: NoteDocument, tab: NoteTab): Section[] => {
  const kind = tabKindOf(tab);
  if (kind === "page")
    return outlineFromLines(
      (note.blocksByTab[tab.id] ?? []).map((block) => ({
        level: headingLevel(block),
        text: headingLevel(block) === null ? blockText(block) : inlineText(block.content),
      })),
    );
  if (kind === "table" || kind === "board") {
    const table = note.tablesByTab?.[tab.id];
    return table ? outlineOfTable(table) : [];
  }
  const graph = note.graphsByTab?.[tab.id];
  return graph ? outlineOfGraph(graph) : [];
};

/** Inline content as the store keeps it, which export and search read. */
const textRun = (text: string) => [{ type: "text" as const, text, styles: {} }];

const paragraph = (text: string): NotePartialBlock => ({
  id: createUuid(),
  type: "paragraph",
  content: textRun(text),
});

const pageFromOutline = (sections: readonly Section[]): NotePartialBlock[] =>
  sections.flatMap((section) => [
    {
      id: createUuid(),
      type: "heading",
      props: { level: section.level as 1 | 2 | 3 },
      content: textRun(section.title),
    },
    ...section.body.map(paragraph),
  ]);

const tableFromOutline = (sections: readonly Section[]): NoteTable => {
  const columns = [createNoteTableColumn("Name", 0), createNoteTableColumn("Notes", 2)];
  columns[1]!.position = 1;
  const rows = sections.map((section, index) => {
    const row = createNoteTableRow(columns, index);
    row.cells[columns[0]!.id] = section.title;
    row.cells[columns[1]!.id] = section.body.join("\n");
    return row;
  });
  return { columns, rows };
};

/** Each section a node, connected from the nearest section above it at a lower level. */
const graphFromOutline = (sections: readonly Section[]): NoteGraph => {
  const nodes = sections.map((section, index) => ({
    ...createNoteGraphNode("process", { x: 0, y: index }),
    title: section.title,
    notes: section.body.join("\n"),
    color: section.level === 1 ? ("green" as const) : ("blue" as const),
  }));
  const edges: NoteGraphEdge[] = [];
  sections.forEach((section, index) => {
    for (let above = index - 1; above >= 0; above -= 1)
      if (sections[above]!.level < section.level) {
        edges.push({ id: createUuid(), source: nodes[above]!.id, target: nodes[index]!.id });
        break;
      }
  });
  const positions = computeNoteGraphTidyLayout({ nodes, edges });
  return {
    enabled: true,
    nodes: nodes.map((node) => ({ ...node, position: positions[node.id] ?? node.position })),
    edges,
    viewport: { x: 0, y: 0, zoom: 0.85 },
  };
};

/**
 * What `tab` holds, carried over to a tab of `kind`; null when there is
 * nothing to carry, and the tab starts as a new one would.
 */
export const convertTabContent = (
  note: NoteDocument,
  tab: NoteTab,
  kind: ConvertibleTabKind,
  parseMarkdown: ParseMarkdown | null,
): TabContent | null => {
  const from = tabKindOf(tab);
  if (kind === "embed") return { kind, embed: { url: "" } };
  const table = from === "table" || from === "board" ? note.tablesByTab?.[tab.id] : undefined;
  // A table and a board hold the same table.
  if (table && kind === "table") return { kind, table };
  if (table && kind === "board") return { kind, table: withBoardGroups(table) };
  if (table && kind === "page" && parseMarkdown) {
    const blocks = parseMarkdown(buildNoteTableMarkdown(table)) as NotePartialBlock[];
    return blocks.length ? { kind, blocks } : null;
  }

  const sections = outlineOf(note, tab);
  if (sections.length === 0) return null;
  if (kind === "page") return { kind, blocks: pageFromOutline(sections) };
  if (kind === "table") return { kind, table: tableFromOutline(sections) };
  if (kind === "board") return { kind, table: withBoardGroups(tableFromOutline(sections)) };
  return { kind, graph: graphFromOutline(sections) };
};

/** Whether converting a `from` tab to `to` needs BlockNote's Markdown parser. */
export const needsMarkdownParser = (from: NoteTabKind, to: NoteTabKind) =>
  to === "page" && (from === "table" || from === "board");

const ROW_OR_NODE: Partial<Record<NoteTabKind, string>> = {
  table: "row",
  board: "card",
  graph: "node",
};

/** What converting a tab of `from` kind to `to` keeps, as a sentence for the confirmation. */
export const describeConversion = (from: NoteTabKind, to: NoteTabKind): string => {
  if (to === "embed")
    return "Its content is deleted, and the tab shows a web page or image instead.";
  if (from === "embed") return "The embedded address is removed.";
  if (from === "table" && to === "board")
    return "Its rows become cards, in columns by their first select column, or by a new Status column.";
  if (from === "board" && to === "table") return "Its cards become rows again, with every column.";
  if ((from === "table" || from === "board") && to === "page")
    return "The table becomes a table in the page.";
  const target = ROW_OR_NODE[to];
  if (from === "page")
    return target
      ? `Each heading becomes a ${target}, with the text under it as its notes.`
      : "Its text carries over.";
  const source = ROW_OR_NODE[from]!;
  return target
    ? `Each ${source} becomes a ${target}.`
    : `Each ${source} becomes a heading, with its notes under it.`;
};

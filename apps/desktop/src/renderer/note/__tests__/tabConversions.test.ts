import { describe, expect, it } from "vitest";

import type { NoteGraph, NoteTab, NoteTable } from "@loam/shared/notes/noteModel";

import type { NotePartialBlock } from "../../editor/noteEditorSchema";
import type { NoteDocument } from "../../workspace/types";
import { convertTabContent, type TabContent } from "../tabConversions";

const NOTE_ID = "00000000-0000-4000-8000-000000000002";

const heading = (text: string, level = 1): NotePartialBlock => ({
  id: `h-${text}`,
  type: "heading",
  props: { level: level as 1 | 2 | 3 },
  content: [{ type: "text", text, styles: {} }],
});
const paragraph = (content: unknown[]) =>
  ({ id: `p-${JSON.stringify(content)}`, type: "paragraph", content }) as NotePartialBlock;

const noteWith = (tab: NoteTab, content: Partial<NoteDocument>): NoteDocument => ({
  id: "note",
  title: "Course",
  updatedAt: "2026-10-13T00:00:00.000Z",
  tabs: [tab],
  activeTabId: tab.id,
  blocksByTab: { [tab.id]: [] },
  ...content,
});

const pageTab: NoteTab = { id: "t", title: "Notes", kind: "page" };
const tableTab: NoteTab = { id: "t", title: "Table", kind: "table" };
const graphTab: NoteTab = { id: "t", title: "Graph", kind: "graph" };

const page = noteWith(pageTab, {
  blocksByTab: {
    t: [
      heading("Cells"),
      paragraph([
        { type: "text", text: "See ", styles: {} },
        {
          type: "link",
          href: `/notes?noteId=${NOTE_ID}`,
          content: [{ type: "text", text: "Biology", styles: {} }],
        },
      ]),
      heading("Membrane", 2),
      paragraph([{ type: "text", text: "Lets water through.", styles: {} }]),
    ],
  },
});

const table = (content: TabContent | null) => (content?.kind === "table" ? content.table : null);
const graph = (content: TabContent | null) => (content?.kind === "graph" ? content.graph : null);
const headings = (content: TabContent | null) =>
  content?.kind === "page"
    ? content.blocks.map((block) => [
        block.type,
        (block.props as { level?: number } | undefined)?.level,
        JSON.stringify(block.content),
      ])
    : null;
const cells = (converted: NoteTable | null) =>
  converted?.rows.map((row) => converted.columns.map((column) => row.cells[column.id]));

const tableNote = noteWith(tableTab, {
  tablesByTab: {
    t: {
      columns: [
        { id: "name", title: "Name", type: "text" },
        { id: "done", title: "Done", type: "boolean" },
      ],
      rows: [{ id: "r", cells: { name: "Read", done: true } }],
    },
  },
});

describe("tab conversions", () => {
  it("makes each heading a table row with the text under it as notes", () => {
    expect(cells(table(convertTabContent(page, pageTab, "table", null)))).toEqual([
      ["Cells", "See Biology"],
      ["Membrane", "Lets water through."],
    ]);
  });

  it("makes each paragraph of a page without headings a row", () => {
    const note = noteWith(pageTab, {
      blocksByTab: {
        t: [
          paragraph([{ type: "text", text: "Mitosis", styles: {} }]),
          paragraph([{ type: "text", text: "Meiosis", styles: {} }]),
        ],
      },
    });
    expect(
      cells(table(convertTabContent(note, pageTab, "table", null)))?.map(([name]) => name),
    ).toEqual(["Mitosis", "Meiosis"]);
  });

  it("connects each heading's node under the heading above it", () => {
    const note = noteWith(pageTab, {
      blocksByTab: {
        t: [heading("Cells"), heading("Membrane", 2), heading("Nucleus", 2), heading("Tissue")],
      },
    });
    const converted = graph(convertTabContent(note, pageTab, "graph", null))!;
    const titleOf = (id: string) => converted.nodes.find((node) => node.id === id)?.title;
    expect(converted.nodes.map((node) => node.title)).toEqual([
      "Cells",
      "Membrane",
      "Nucleus",
      "Tissue",
    ]);
    expect(converted.edges.map((edge) => [titleOf(edge.source), titleOf(edge.target)])).toEqual([
      ["Cells", "Membrane"],
      ["Cells", "Nucleus"],
    ]);
  });

  it("puts a table in a page as a Markdown table, with the parser it is given", () => {
    const parsed = [heading("Parsed")];
    const seen: string[] = [];
    const parse = (markdown: string) => {
      seen.push(markdown);
      return parsed;
    };
    expect(convertTabContent(tableNote, tableTab, "page", parse)).toEqual({
      kind: "page",
      blocks: parsed,
    });
    expect(seen).toEqual(["| Name | Done |\n| --- | --- |\n| Read | Yes |"]);
  });

  it("writes a graph's nodes as headings nested along its connections", () => {
    const nodes: NoteGraph["nodes"] = [
      { id: "b", title: "Branch", notes: "Detail", position: { x: 300, y: 0 } },
      { id: "a", title: "Root", position: { x: 0, y: 0 } },
      { id: "f", title: "Group", shape: "frame", position: { x: -40, y: -40 } },
    ];
    const note = noteWith(graphTab, {
      graphsByTab: {
        t: { enabled: true, nodes, edges: [{ id: "e", source: "a", target: "b" }] },
      },
    });
    expect(headings(convertTabContent(note, graphTab, "page", null))).toEqual([
      ["heading", 1, JSON.stringify([{ type: "text", text: "Root", styles: {} }])],
      ["heading", 2, JSON.stringify([{ type: "text", text: "Branch", styles: {} }])],
      ["paragraph", undefined, JSON.stringify([{ type: "text", text: "Detail", styles: {} }])],
    ]);
  });

  it("carries nothing over from an empty tab", () => {
    expect(convertTabContent(noteWith(pageTab, {}), pageTab, "table", null)).toBeNull();
  });
});

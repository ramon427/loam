import { describe, expect, it } from "vitest";

import type { NoteContent } from "../noteModel";
import {
  normalizeNoteHeadingBlockIds,
  removeBrokenHeadingConnections,
} from "../headingConnections";

const heading = (id: string, level?: number, children: unknown[] = []) => ({
  id,
  type: "heading",
  props: level === undefined ? {} : { level },
  content: [],
  children,
});

const note = (headingBlockIds: string[]): NoteContent => ({
  title: "Plan",
  activeTabId: "text",
  tabs: [
    { id: "text", title: "Text", kind: "page" },
    { id: "graph", title: "Graph", kind: "graph" },
    { id: "table", title: "Table", kind: "table" },
  ],
  blocksByTab: {
    text: [
      heading("kept", 2, [heading("nested")]),
      heading("too-deep", 4),
      { id: "paragraph", type: "paragraph", content: [], children: [] },
      heading("twice"),
    ],
    // A heading outside a page tab, and a second block with the id "twice".
    graph: [heading("in-graph-tab"), { id: "twice", type: "paragraph" }],
    table: [],
  },
  graphsByTab: {
    graph: {
      enabled: true,
      nodes: [{ id: "node", title: "Node", position: { x: 0, y: 0 }, headingBlockIds }],
      edges: [],
    },
  },
  tablesByTab: {
    table: {
      columns: [{ id: "column", title: "Column", type: "text" }],
      rows: [{ id: "row", cells: {}, headingBlockIds: ["kept"] }],
    },
  },
});

describe("removeBrokenHeadingConnections", () => {
  it("keeps connections to level 1 to 3 headings in page tabs, at any depth", () => {
    const valid = note(["kept", "nested"]);
    expect(removeBrokenHeadingConnections(valid)).toBe(valid);
  });

  it("removes connections to missing, repeated, deep or non-page-tab headings", () => {
    const cleaned = removeBrokenHeadingConnections(
      note(["missing", "kept", "too-deep", "paragraph", "twice", "in-graph-tab"]),
    );
    expect(cleaned.graphsByTab?.graph?.nodes[0]?.headingBlockIds).toEqual(["kept"]);
  });

  it("drops the field when no connection is left, and leaves other targets as they were", () => {
    const original = note(["missing"]);
    const cleaned = removeBrokenHeadingConnections(original);
    expect(cleaned.graphsByTab?.graph?.nodes[0]).not.toHaveProperty("headingBlockIds");
    expect(cleaned.tablesByTab).toBe(original.tablesByTab);
  });

  it("opens notes whose graphs or tables lack their lists", () => {
    const malformed = {
      ...note(["kept"]),
      graphsByTab: { graph: {} },
      tablesByTab: { table: { columns: [] } },
    } as unknown as NoteContent;
    expect(removeBrokenHeadingConnections(malformed)).toBe(malformed);
  });
});

describe("normalizeNoteHeadingBlockIds", () => {
  it("trims, drops repeats and blanks, and keeps at most 200", () => {
    expect(normalizeNoteHeadingBlockIds([" a ", "a", "", 3, "b"])).toEqual(["a", "b"]);
    expect(normalizeNoteHeadingBlockIds(["", " "])).toBeUndefined();
    expect(normalizeNoteHeadingBlockIds("a")).toBeUndefined();
    const many = Array.from({ length: 250 }, (_, index) => `h${index}`);
    expect(normalizeNoteHeadingBlockIds(many)).toHaveLength(200);
  });
});

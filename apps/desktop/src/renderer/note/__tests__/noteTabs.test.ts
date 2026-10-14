import type { PartialBlock } from "@blocknote/core";
import { describe, expect, it } from "vitest";

import type { NoteDocument } from "../../workspace/types";
import {
  activeTabOf,
  addFileTab,
  addTab,
  changeTabKind,
  deleteTab,
  describeTabRemoval,
  moveTab,
  renameTab,
  tabHasContent,
} from "../noteTabs";

const heading: PartialBlock = {
  id: "heading-1",
  type: "heading",
  content: "Plan",
  props: { level: 1 },
};

/** A note with a page tab holding a heading, and a graph whose node links to it. */
const note = (): NoteDocument => ({
  id: "note-1",
  title: "Course",
  updatedAt: "2026-01-01T00:00:00.000Z",
  contentState: "full",
  tabs: [
    { id: "text", title: "Notes", kind: "page", position: 0 },
    { id: "graph", title: "Map", kind: "graph", position: 1 },
  ],
  activeTabId: "text",
  blocksByTab: { text: [heading], graph: [] },
  graphsByTab: {
    graph: {
      enabled: true,
      nodes: [
        {
          id: "node-1",
          title: "Idea",
          position: { x: 0, y: 0 },
          headingBlockIds: ["heading-1"],
        },
      ],
      edges: [],
    },
  },
  tablesByTab: {},
});

const linkedHeadings = (patch: { graphsByTab?: NoteDocument["graphsByTab"] } | null) =>
  patch?.graphsByTab?.graph?.nodes[0]?.headingBlockIds;

describe("note tabs", () => {
  it("adds a tab of each kind with fresh content and shows it", () => {
    const page = addTab(note(), "page")!;
    const added = page.tabs!.at(-1)!;
    expect(added).toMatchObject({ kind: "page", title: "Page", position: 2 });
    expect(page.activeTabId).toBe(added.id);
    expect(page.blocksByTab![added.id]).toHaveLength(1);

    const table = addTab(note(), "table")!;
    const tableTab = table.tabs!.at(-1)!;
    expect(tableTab.title).toBe("Table");
    expect(table.tablesByTab![tableTab.id]!.columns.length).toBeGreaterThan(0);
    expect(table.blocksByTab![tableTab.id]).toEqual([]);
  });

  it("lets a former Text tab's Markdown go with the content its kind change replaces", () => {
    const current = {
      ...note(),
      tabs: [...note().tabs, { id: "old", title: "Text", kind: "graph" as const, position: 2 }],
      textsByTab: { old: "Draft" },
    };
    expect(changeTabKind(current, "old", "table")!.textsByTab).toEqual({});
    expect(deleteTab(current, "old")!.textsByTab).toEqual({});
  });

  it("refuses a tab past the limit", () => {
    const full = note();
    full.tabs = Array.from({ length: 24 }, (_, index) => ({ id: `tab-${index}`, title: "Tab" }));
    expect(addTab(full, "page")).toBeNull();
  });

  it("numbers a new tab whose kind's name is taken", () => {
    const current = note();
    current.tabs.push({ id: "table", title: "Table", kind: "table", position: 2 });
    expect(addTab(current, "table")!.tabs!.at(-1)!.title).toBe("Table 2");
  });

  it("names a renamed tab, or Untitled when the name is blank", () => {
    expect(renameTab(note(), "text", "  Lecture 1 ").tabs![0]!.title).toBe("Lecture 1");
    expect(renameTab(note(), "text", "   ").tabs![0]!.title).toBe("Untitled");
  });

  it("deletes a page tab, unlinking its headings, and shows the first tab", () => {
    const shown = { ...note(), activeTabId: "text" };
    const patch = deleteTab(shown, "text")!;
    expect(patch.tabs!.map((tab) => tab.id)).toEqual(["graph"]);
    expect(patch.activeTabId).toBe("graph");
    expect(Object.keys(patch.blocksByTab!)).toEqual(["graph"]);
    expect(linkedHeadings(patch)).toBeUndefined();
  });

  it("deletes a graph tab with its graph and keeps the last tab", () => {
    const patch = deleteTab(note(), "graph")!;
    expect(patch.graphsByTab).toEqual({});
    expect(patch.activeTabId).toBe("text");
    expect(deleteTab({ ...note(), tabs: [note().tabs[0]!] }, "text")).toBeNull();
  });

  it("moves a tab and renumbers the tabs", () => {
    const patch = moveTab(note(), "graph", "text", "before")!;
    expect(patch.tabs!.map((tab) => [tab.id, tab.position])).toEqual([
      ["graph", 0],
      ["text", 1],
    ]);
    expect(moveTab(note(), "text", "graph", "before")).toBeNull();
  });

  it("changes a page tab into a table, unlinking its headings", () => {
    const patch = changeTabKind(note(), "text", "table")!;
    expect(patch.tabs![0]).toMatchObject({ kind: "table", title: "Notes" });
    expect(patch.blocksByTab!.text).toEqual([]);
    expect(patch.tablesByTab!.text).toBeDefined();
    expect(patch.activeTabId).toBe("text");
    expect(linkedHeadings(patch)).toBeUndefined();
    expect(changeTabKind(note(), "graph", "graph")).toBeNull();
  });

  it("renames a tab that changes kind only when its name came from its kind", () => {
    const current = note();
    current.tabs[1] = { ...current.tabs[1]!, title: "Graph 2" };
    expect(changeTabKind(current, "graph", "table")!.tabs![1]!.title).toBe("Table");
    expect(changeTabKind(note(), "graph", "table")!.tabs![1]!.title).toBe("Map");
  });

  it("adds a file tab named after its file, which keeps its kind and goes with its file", () => {
    const file = {
      name: "Lecture 3.pdf",
      source: { kind: "imported", fileName: "a.pdf" },
    } as const;
    const added = addFileTab(note(), "pdf", file)!;
    const tab = added.tabs!.at(-1)!;
    expect(tab).toMatchObject({ kind: "pdf", title: "Lecture 3" });
    expect(added.filesByTab).toEqual({ [tab.id]: file });
    expect(added.activeTabId).toBe(tab.id);

    const current = { ...note(), ...added } as NoteDocument;
    expect(tabHasContent(current, tab)).toBe(true);
    expect(changeTabKind(current, tab.id, "page")).toBeNull();
    expect(deleteTab(current, tab.id)!.filesByTab).toEqual({});
  });

  it("tells which tabs hold content and what removing one unlinks", () => {
    const current = note();
    expect(tabHasContent(current, current.tabs[0]!)).toBe(true);
    expect(tabHasContent({ ...current, blocksByTab: { text: [] } }, current.tabs[0]!)).toBe(false);
    expect(describeTabRemoval(current, current.tabs[0]!)).toBe(
      "This will disconnect 1 heading connection from 1 graph or table target.",
    );
    expect(describeTabRemoval(current, current.tabs[1]!)).toBe(
      "This will remove 1 heading connection owned by 1 connected target in this tab.",
    );
    expect(activeTabOf({ ...current, activeTabId: "graph" }).title).toBe("Map");
  });
});

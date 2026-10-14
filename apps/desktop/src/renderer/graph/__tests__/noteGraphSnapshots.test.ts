import { describe, expect, it } from "vitest";
import type { NoteGraphSnapshot, NoteGraph, NoteGraphNode } from "@loam/shared/notes/noteModel";
import {
  decodeNoteGraphSnapshot,
  encodeNoteGraphSnapshot,
  noteGraphSnapshotRect,
  readNoteGraphSnapshot,
} from "@loam/shared/notes/noteGraphSnapshot";
import { createNoteGraphSnapshotScene } from "../noteGraphSnapshotScene";
import { insertNoteGraphSnapshot } from "../noteGraphSnapshotInsertion";
import { MAX_TABS } from "../../note/noteTabs";
import type { NotePartialBlock } from "../../editor/noteEditorSchema";
import type { NoteDocument } from "../../workspace/types";

const snapshot: NoteGraphSnapshot = {
  noteId: "source",
  tabId: "graph",
  x: 0,
  y: 0,
  width: 300,
  height: 200,
};
const node = (id: string, x: number, y: number): NoteGraphNode => ({
  id,
  title: id,
  position: { x, y },
  size: { width: 100, height: 60 },
});
const note: NoteDocument = {
  id: "source",
  title: "Notes",
  updatedAt: "2026-10-11T00:00:00Z",
  activeTabId: "graph",
  tabs: [
    { id: "text", title: "Notes" },
    { id: "graph", title: "Graph", kind: "graph" },
  ],
  blocksByTab: {
    text: [
      { id: "body", type: "paragraph", content: "Keep this" },
      { type: "paragraph", content: [] },
    ],
    graph: [],
  },
  graphsByTab: { graph: { enabled: true, nodes: [node("idea", 40, 40)], edges: [] } },
};

describe("live graph snapshot references", () => {
  it("round-trips a reference without copying graph content", () => {
    const encoded = encodeNoteGraphSnapshot(snapshot);
    expect(decodeNoteGraphSnapshot(encoded)).toEqual(snapshot);
    expect(encoded.length).toBeLessThan(200);
    expect(noteGraphSnapshotRect({ x: 200, y: 300 }, { x: -20, y: -10 })).toEqual({
      x: -20,
      y: -10,
      width: 220,
      height: 310,
    });
  });
  it.each([
    { ...snapshot, width: 0 },
    { ...snapshot, height: -2 },
    { ...snapshot, x: Infinity },
    { ...snapshot, y: NaN },
    { ...snapshot, x: 1e12 },
    { ...snapshot, tabId: "" },
    { ...snapshot, noteId: " " },
    { ...snapshot, width: "300" },
  ])("rejects invalid persisted geometry: %j", (value) => {
    expect(readNoteGraphSnapshot(value)).toBeNull();
  });
  it("leaves ordinary text and malformed clipboard payloads alone", () => {
    expect(decodeNoteGraphSnapshot("Normal note text")).toBeNull();
    expect(decodeNoteGraphSnapshot("loam-graph-snapshot:{broken")).toBeNull();
  });
});

describe("snapshot insertion and persistence", () => {
  it("preserves text and source graph, replaces a trailing empty line, and switches to the destination", () => {
    const inserted = insertNoteGraphSnapshot(note, snapshot, "text")!;
    expect(inserted.activeTabId).toBe("text");
    expect(inserted.graphsByTab).toBe(note.graphsByTab);
    expect(inserted.blocksByTab.text[0]).toBe(note.blocksByTab.text[0]);
    const stored = JSON.parse(JSON.stringify(inserted.blocksByTab.text)) as NotePartialBlock[];
    expect(stored.map((block) => block.type)).toEqual(["paragraph", "graphSnapshot", "paragraph"]);
    expect(readNoteGraphSnapshot(stored[1]!.props)).toEqual(snapshot);
    expect(note.blocksByTab.text).toHaveLength(2);
  });
  it("creates a page tab for a graph-only note, and never overwrites typed tabs", () => {
    const graphOnly = { ...note, tabs: note.tabs.slice(1) };
    const inserted = insertNoteGraphSnapshot(graphOnly, snapshot)!;
    expect(inserted.tabs.map((tab) => tab.kind)).toEqual(["graph", "page"]);
    expect(inserted.blocksByTab.graph).toBe(note.blocksByTab.graph);
    expect(insertNoteGraphSnapshot(note, snapshot, "graph")).toBeNull();
    expect(
      insertNoteGraphSnapshot(
        {
          ...graphOnly,
          tabs: Array.from({ length: MAX_TABS }, (_, index) => ({
            id: `graph-${index}`,
            title: "Graph",
            kind: "graph" as const,
          })),
        },
        snapshot,
      ),
    ).toBeNull();
  });
});

describe("fixed canvas area previews", () => {
  it("captures an empty area and includes nodes that later enter it, while clipping partial nodes", () => {
    const graph: NoteGraph = { enabled: true, nodes: [node("outside", 500, 500)], edges: [] };
    expect(createNoteGraphSnapshotScene(graph, snapshot).nodes).toEqual([]);
    const changed = {
      ...graph,
      nodes: [node("inside", 30, 30), node("partial", 290, 100), node("outside", 500, 500)],
    };
    expect(createNoteGraphSnapshotScene(changed, snapshot).nodes.map((item) => item.id)).toEqual([
      "inside",
      "partial",
    ]);
    expect(createNoteGraphSnapshotScene({ ...changed, nodes: [] }, snapshot).nodes).toEqual([]);
  });
  it("retains a connector crossing the area even when both endpoints are outside it", () => {
    const graph: NoteGraph = {
      enabled: true,
      nodes: [node("left", -300, 50), node("right", 500, 50)],
      edges: [{ id: "crossing", source: "left", target: "right", type: "straight" }],
    };
    const scene = createNoteGraphSnapshotScene(graph, snapshot);
    expect(scene.nodes).toHaveLength(0);
    expect(scene.edges.map(({ edge }) => edge.id)).toEqual(["crossing"]);
    expect(scene.edges[0]!.path).toContain("-200");
  });
  it("follows collapsed frames and hides their children and connectors", () => {
    const graph: NoteGraph = {
      enabled: true,
      nodes: [
        {
          ...node("frame", 0, 0),
          shape: "frame",
          collapsed: true,
          expandedSize: { width: 400, height: 300 },
        },
        node("child", 50, 50),
        node("peer", 500, 50),
      ],
      edges: [{ id: "hidden", source: "child", target: "peer" }],
    };
    expect(createNoteGraphSnapshotScene(graph, snapshot).nodes.map((item) => item.id)).toEqual([
      "frame",
    ]);
    expect(createNoteGraphSnapshotScene(graph, snapshot).edges).toHaveLength(0);
  });
});

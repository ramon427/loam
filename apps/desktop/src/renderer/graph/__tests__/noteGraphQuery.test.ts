import { describe, expect, it } from "vitest";

import {
  filterNoteGraphNodeIds,
  formatNoteGraphSummary,
  isNoteGraphFilterActive,
  searchNoteGraphNodes,
  summarizeNoteGraph,
} from "../noteGraphQuery";
import type { NoteGraphNode } from "@loam/shared/notes/noteModel";

const nodeAt = (
  id: string,
  x: number,
  y: number,
  patch?: Partial<NoteGraphNode>,
): NoteGraphNode => ({
  id,
  title: id,
  position: { x, y },
  size: { width: 100, height: 50 },
  ...patch,
});

describe("noteGraphQuery", () => {
  it("searches titles and notes case-insensitively with all terms", () => {
    const nodes = [
      nodeAt("a", 0, 0, { title: "Liquidity sweep" }),
      nodeAt("b", 0, 0, { title: "Entry", notes: "wait for the sweep" }),
      nodeAt("c", 0, 0, { title: "Exit" }),
    ];
    expect(searchNoteGraphNodes(nodes, "sweep").sort()).toEqual(["a", "b"]);
    expect(searchNoteGraphNodes(nodes, "SWEEP entry")).toEqual(["b"]);
    expect(searchNoteGraphNodes(nodes, "")).toEqual([]);
  });

  it("filters by color, timestamp, headings, and orphan state", () => {
    const nodes = [
      nodeAt("a", 0, 0, { color: "red", timestampSeconds: 10 }),
      nodeAt("b", 0, 0, { color: "blue", headingBlockIds: ["h1"] }),
      nodeAt("c", 0, 0, { color: "red" }),
    ];
    const edges = [{ source: "a", target: "b" }];
    expect(Array.from(filterNoteGraphNodeIds(nodes, edges, { colors: ["red"] })).sort()).toEqual([
      "a",
      "c",
    ]);
    expect(Array.from(filterNoteGraphNodeIds(nodes, edges, { hasTimestamp: true }))).toEqual(["a"]);
    expect(Array.from(filterNoteGraphNodeIds(nodes, edges, { hasHeadings: true }))).toEqual(["b"]);
    expect(Array.from(filterNoteGraphNodeIds(nodes, edges, { orphansOnly: true }))).toEqual(["c"]);
    expect(isNoteGraphFilterActive({})).toBe(false);
    expect(isNoteGraphFilterActive({ orphansOnly: true })).toBe(true);
  });

  it("summarizes graph structure", () => {
    const summary = summarizeNoteGraph({
      nodes: [nodeAt("a", 0, 0), nodeAt("b", 0, 0), nodeAt("c", 0, 0)],
      edges: [
        { id: "1", source: "a", target: "b" },
        { id: "2", source: "b", target: "c" },
      ],
    });
    expect(summary).toEqual({
      nodeCount: 3,
      edgeCount: 2,
      rootCount: 1,
    });
    expect(
      formatNoteGraphSummary({
        nodes: [nodeAt("a", 0, 0)],
        edges: [],
      }),
    ).toBe("1 root · 1 node · 0 connectors");
  });
});

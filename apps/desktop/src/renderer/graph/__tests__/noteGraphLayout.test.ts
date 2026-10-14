import { describe, expect, it } from "vitest";

import {
  alignNoteGraphNodes,
  buildNoteGraphPlaybackEdges,
  computeNoteGraphGridLayout,
  computeNoteGraphRadialLayout,
  computeNoteGraphTidyLayout,
  computeNoteGraphTimelineLayout,
  computeNoteGraphVerticalLayout,
  countNoteGraphCycleEdges,
  distributeNoteGraphNodes,
  repairNoteGraphOverlaps,
  resolveNoteGraphClusterColors,
} from "../noteGraphLayout";
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

describe("noteGraphLayout", () => {
  it("aligns and distributes selections", () => {
    const nodes = [nodeAt("a", 0, 0), nodeAt("b", 200, 40), nodeAt("c", 500, 90)];
    const ids = new Set(["a", "b", "c"]);
    expect(alignNoteGraphNodes(nodes, ids, "left")).toEqual({
      b: { x: 0, y: 40 },
      c: { x: 0, y: 90 },
    });
    const distributed = distributeNoteGraphNodes(nodes, ids, "horizontal");
    // Middle node centered between the outer edges: total span 0..600,
    // widths 100 each, gap (600-300)/2=150 → b.x = 0+100+150.
    expect(distributed.b).toEqual({ x: 250, y: 40 });
    expect(distributed.a).toBeUndefined();
    expect(distributeNoteGraphNodes(nodes, new Set(["a", "b"]), "horizontal")).toEqual({});
  });

  it("repairs overlaps deterministically and leaves clean graphs alone", () => {
    const overlapping = [nodeAt("a", 0, 0), nodeAt("b", 10, 10)];
    const repaired = repairNoteGraphOverlaps(overlapping);
    expect(repaired.b?.y).toBeGreaterThanOrEqual(50 + 24);
    expect(
      repairNoteGraphOverlaps([nodeAt("a", 0, 0), { ...nodeAt("b", 0, 0), position: repaired.b! }]),
    ).toEqual({});
    expect(repairNoteGraphOverlaps([nodeAt("a", 0, 0), nodeAt("b", 500, 500)])).toEqual({});
  });

  it("counts cycle edges only when the graph loops", () => {
    const nodes = [nodeAt("a", 0, 0), nodeAt("b", 0, 0), nodeAt("c", 0, 0)];
    expect(
      countNoteGraphCycleEdges(nodes, [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ]),
    ).toBe(0);
    expect(
      countNoteGraphCycleEdges(nodes, [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
        { source: "c", target: "a" },
      ]),
    ).toBe(3);
  });

  it("colors connected clusters deterministically by size", () => {
    const nodes = [nodeAt("a", 0, 0), nodeAt("b", 0, 0), nodeAt("c", 0, 0)];
    const colors = resolveNoteGraphClusterColors(nodes, [{ source: "a", target: "b" }]);
    expect(colors.a).toBe(colors.b);
    expect(colors.c).not.toBe(colors.a);
  });

  it("lays out timestamped nodes chronologically and chains them", () => {
    const nodes = [
      nodeAt("late", 0, 0, { timestampSeconds: 300 }),
      nodeAt("early", 500, 400, { timestampSeconds: 60 }),
      nodeAt("plain", 900, 900),
    ];
    const positions = computeNoteGraphTimelineLayout(nodes);
    expect(positions.early!.x).toBeLessThan(positions.late!.x);
    expect(positions.plain).toBeUndefined();
    const chain = buildNoteGraphPlaybackEdges(nodes);
    expect(chain).toHaveLength(1);
    expect(chain[0]).toMatchObject({ source: "early", target: "late", dashed: true });
  });

  it("computes radial and vertical layouts without overlapping the root", () => {
    const graph = {
      nodes: [nodeAt("root", 400, 300), nodeAt("a", 0, 0), nodeAt("b", 0, 0)],
      edges: [
        { id: "1", source: "root", target: "a" },
        { id: "2", source: "root", target: "b" },
      ],
    };
    const radial = computeNoteGraphRadialLayout(graph);
    expect(radial.root).toBeUndefined();
    expect(radial.a).toBeDefined();
    expect(radial.b).toBeDefined();
    expect(radial.a).not.toEqual(radial.b);
    const vertical = computeNoteGraphVerticalLayout(graph);
    expect(vertical.root!.y).toBeLessThan(vertical.a!.y);
    expect(vertical.a!.y).toBe(vertical.b!.y);
  });

  it("lays out a tidy tree in columns by depth, even around a cycle", () => {
    const tidy = computeNoteGraphTidyLayout({
      nodes: [nodeAt("root", 500, 0), nodeAt("child", 0, 0), nodeAt("grandchild", 0, 0)],
      edges: [
        { id: "1", source: "root", target: "child" },
        { id: "2", source: "child", target: "grandchild" },
        { id: "3", source: "root", target: "grandchild" },
      ],
    });
    expect([tidy.root!.x, tidy.child!.x, tidy.grandchild!.x]).toEqual([80, 420, 760]);

    const loop = computeNoteGraphTidyLayout({
      nodes: [nodeAt("a", 0, 0), nodeAt("b", 0, 100)],
      edges: [
        { id: "1", source: "a", target: "b" },
        { id: "2", source: "b", target: "a" },
      ],
    });
    expect([loop.a!.x, loop.b!.x]).toEqual([80, 80]);
  });

  it("lays out a grid in reading order, ignoring connectors", () => {
    const grid = computeNoteGraphGridLayout([
      nodeAt("second", 300, 0),
      nodeAt("first", 0, 0),
      nodeAt("third", 0, 200),
    ]);
    expect(grid).toEqual({
      first: { x: 80, y: 80 },
      second: { x: 80 + 196, y: 80 },
      third: { x: 80, y: 80 + 114 },
    });
  });
});

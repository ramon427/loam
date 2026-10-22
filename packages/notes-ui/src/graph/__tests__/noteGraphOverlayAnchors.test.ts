import { describe, expect, it } from "vitest";

import type { NoteGraph, NoteGraphEdge, NoteGraphNode } from "@loam/shared/notes/noteModel";
import { edgeLabelEditorPoint, selectionToolbarAnchor } from "../noteGraphOverlayAnchors";

const nodeAt = (id: string, x: number, y: number): NoteGraphNode => ({
  id,
  title: id,
  position: { x, y },
  size: { width: 100, height: 50 },
});

const a = nodeAt("a", 0, 0);
const b = nodeAt("b", 300, 100);
const edge: NoteGraphEdge = { id: "a-b", source: "a", target: "b" };

describe("selectionToolbarAnchor", () => {
  it("points over the middle of the selected nodes' bounds", () => {
    expect(
      selectionToolbarAnchor({
        selectedNodes: [a, b],
        selectedEdge: null,
        nodes: [a, b],
        measured: new Map(),
      }),
    ).toEqual({ x: 200, top: 0, bottom: 150 });
  });

  it("uses the size a node is drawn at over the one it stores", () => {
    expect(
      selectionToolbarAnchor({
        selectedNodes: [a],
        selectedEdge: null,
        nodes: [a],
        measured: new Map([["a", { width: 200, height: 80 }]]),
      }),
    ).toEqual({ x: 100, top: 0, bottom: 80 });
  });

  it("points at a selected edge's midpoint, clear of the line", () => {
    expect(
      selectionToolbarAnchor({
        selectedNodes: [],
        selectedEdge: edge,
        nodes: [a, b],
        measured: new Map(),
      }),
    ).toEqual({ x: 200, top: 61, bottom: 89 });
  });

  it("has no anchor without a selection or for an edge whose node is gone", () => {
    expect(
      selectionToolbarAnchor({
        selectedNodes: [],
        selectedEdge: null,
        nodes: [a],
        measured: new Map(),
      }),
    ).toBeNull();
    expect(
      selectionToolbarAnchor({
        selectedNodes: [],
        selectedEdge: edge,
        nodes: [a],
        measured: new Map(),
      }),
    ).toBeNull();
  });
});

describe("edgeLabelEditorPoint", () => {
  it("opens at the edge's midpoint, and nowhere for an edge the graph lacks", () => {
    const graph = { nodes: [a, b], edges: [edge] } as unknown as NoteGraph;
    expect(edgeLabelEditorPoint(graph, "a-b")).toEqual({ x: 200, y: 75 });
    expect(edgeLabelEditorPoint(graph, "missing")).toBeNull();
  });
});

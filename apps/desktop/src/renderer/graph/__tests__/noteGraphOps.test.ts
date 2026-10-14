import { describe, expect, it } from "vitest";

import { MAX_NOTE_GRAPH_NODES } from "@loam/shared/notes/noteGraphSchema";
import {
  addNode,
  applyLayout,
  chainNode,
  deleteSelection,
  duplicateNodesAt,
  pasteClipboard,
  reorderSelection,
  resizeNode,
  reverseEdge,
  toggleFrameCollapsed,
  toggleLockSelection,
  updateNode,
  type NoteGraphSelection,
  type NoteGraphState,
} from "../noteGraphOps";
import type { NoteGraph, NoteGraphNode } from "@loam/shared/notes/noteModel";

const node = (id: string, x = 0, y = 0, extra: Partial<NoteGraphNode> = {}): NoteGraphNode => ({
  id,
  title: id,
  position: { x, y },
  size: { width: 120, height: 60 },
  ...extra,
});

const stateOf = (
  nodes: NoteGraphNode[],
  edges: NoteGraph["edges"] = [],
  selection: Partial<NoteGraphSelection> = {},
): NoteGraphState => ({
  graph: { enabled: true, nodes, edges },
  selection: { nodeIds: [], edgeId: null, ...selection },
});

const fullGraph = () =>
  stateOf(
    Array.from({ length: MAX_NOTE_GRAPH_NODES }, (_, index) => node(`n${index}`)),
    [],
    {
      nodeIds: ["n0"],
    },
  );

describe("note graph operations", () => {
  it("chains a renamed node to a new connected child in one edit", () => {
    const edit = chainNode(stateOf([node("a", 100, 40)]), {
      sourceId: "a",
      kind: "child",
      patch: { title: "Renamed" },
    })!;

    const added = edit.graph!.nodes[1]!;
    expect(edit.graph!.nodes[0]!.title).toBe("Renamed");
    expect(added.position).toEqual({ x: 100 + 120 + 96, y: 40 });
    expect(edit.graph!.edges).toEqual([expect.objectContaining({ source: "a", target: added.id })]);
    expect(edit.selection).toEqual({ nodeIds: [added.id], edgeId: null });
  });

  it("chains a sibling below the node, connected to the same parent", () => {
    const edit = chainNode(
      stateOf([node("parent"), node("a", 0, 100)], [{ id: "e", source: "parent", target: "a" }]),
      { sourceId: "a", kind: "sibling" },
    )!;

    const added = edit.graph!.nodes[2]!;
    expect(added.position).toEqual({ x: 0, y: 100 + 60 + 64 });
    expect(edit.graph!.edges[1]).toMatchObject({ source: "parent", target: added.id });
  });

  it("keeps the edit but adds nothing at the node limit", () => {
    const edit = chainNode(fullGraph(), {
      sourceId: "n0",
      kind: "child",
      patch: { title: "Kept" },
    })!;

    expect(edit.announce).toBe(`Node limit reached (${MAX_NOTE_GRAPH_NODES})`);
    expect(edit.graph!.nodes).toHaveLength(MAX_NOTE_GRAPH_NODES);
    expect(edit.graph!.nodes[0]!.title).toBe("Kept");
  });

  it.each([
    [
      "adding",
      (state: NoteGraphState) => addNode(state, { shape: "process", position: { x: 0, y: 0 } }),
    ],
    [
      "pasting",
      (state: NoteGraphState) => pasteClipboard(state, { nodes: [node("copy")], edges: [] }, null),
    ],
    [
      "Alt+drag duplicating",
      (state: NoteGraphState) => duplicateNodesAt(state, new Map([["n0", { x: 9, y: 9 }]])),
    ],
  ])("refuses %s past the node limit", (_label, operation) => {
    expect(operation(fullGraph())).toEqual({
      announce: `Node limit reached (${MAX_NOTE_GRAPH_NODES})`,
    });
  });

  it("adds a node with its shape's defaults where it was asked, even to an empty graph", () => {
    const edit = addNode(stateOf([]), { shape: "text", position: { x: 10.4, y: 20.6 } });

    expect(edit.graph!.nodes).toEqual([
      expect.objectContaining({ shape: "text", title: "Text", position: { x: 10, y: 21 } }),
    ]);
  });

  it("drops Alt+drag copies where the drag ended and copies connectors between them", () => {
    const edit = duplicateNodesAt(
      stateOf([node("a"), node("b", 200)], [{ id: "e", source: "a", target: "b" }]),
      new Map([
        ["a", { x: 10.4, y: 20 }],
        ["b", { x: 210, y: 20 }],
      ]),
    )!;

    const [copyA, copyB] = edit.graph!.nodes.slice(2);
    expect(copyA!.position).toEqual({ x: 10, y: 20 });
    expect(edit.graph!.nodes.slice(0, 2).map((item) => item.position.x)).toEqual([0, 200]);
    expect(edit.graph!.edges[1]).toMatchObject({ source: copyA!.id, target: copyB!.id });
  });

  it("deletes the selection with its connectors but keeps locked nodes", () => {
    const edit = deleteSelection(
      stateOf(
        [node("a"), node("b", 0, 0, { locked: true }), node("c")],
        [{ id: "e", source: "a", target: "c" }],
        { nodeIds: ["a", "b"] },
      ),
    )!;

    expect(edit.graph!.nodes.map((item) => item.id)).toEqual(["b", "c"]);
    expect(edit.graph!.edges).toEqual([]);
    expect(edit.announce).toBe("Deleted 1; locked items kept");
  });

  it("refuses to change a locked node unless the change unlocks it", () => {
    const state = stateOf([node("a", 0, 0, { locked: true })]);

    expect(updateNode(state, "a", { title: "x" })).toEqual({ announce: "Node is locked" });
    expect(updateNode(state, "a", { locked: false })!.graph!.nodes[0]!.locked).toBe(false);
  });

  it("reverses a connector, unless that would duplicate one going the other way", () => {
    const edges = [{ id: "ab", source: "a", target: "b" }];
    const reversed = reverseEdge(stateOf([node("a"), node("b")], edges), "ab")!;
    expect(reversed.graph!.edges).toEqual([{ id: "ab", source: "b", target: "a" }]);

    const both = stateOf(
      [node("a"), node("b")],
      [...edges, { id: "ba", source: "b", target: "a" }],
    );
    expect(reverseEdge(both, "ab")).toEqual({ announce: "Already connected" });
  });

  it("collapsing a frame hides its members from the selection", () => {
    const frame = node("frame", 0, 0, { shape: "frame", size: { width: 400, height: 300 } });
    const edit = toggleFrameCollapsed(
      stateOf([frame, node("inside", 40, 100), node("outside", 800)], [], {
        nodeIds: ["inside", "outside"],
      }),
      "frame",
    )!;

    expect(edit.graph!.nodes[0]).toMatchObject({
      collapsed: true,
      expandedSize: { width: 400, height: 300 },
    });
    expect(edit.selection).toEqual({ nodeIds: ["outside"], edgeId: null });
  });

  it("snaps a resize to the grid, and keeps a collapsed frame at its title bar size", () => {
    const resized = resizeNode(stateOf([node("a")]), "a", { width: 250, height: 70, x: 5, y: 6 })!;
    expect(resized.graph!.nodes[0]).toMatchObject({
      size: { width: 256, height: 64 },
      position: { x: 5, y: 6 },
    });

    const collapsed = node("f", 0, 0, {
      title: "Group",
      shape: "frame",
      collapsed: true,
      size: { width: 200, height: 44 },
    });
    const kept = resizeNode(stateOf([collapsed]), "f", { width: 600, height: 400 })!;
    expect(kept.graph!.nodes[0]!.size).toEqual({ width: 200, height: 44 });
  });

  it("brings the selection to the front while frames stay below other nodes", () => {
    const edit = reorderSelection(
      stateOf([node("frame", 0, 0, { shape: "frame" }), node("a"), node("b")], [], {
        nodeIds: ["a", "frame"],
      }),
      "front",
    )!;

    expect(edit.graph!.nodes.map((item) => item.id)).toEqual(["frame", "b", "a"]);
  });

  it("locks a mixed selection and unlocks a fully locked one", () => {
    const state = stateOf([node("a"), node("b", 0, 0, { locked: true })], [], {
      nodeIds: ["a", "b"],
    });
    const locked = toggleLockSelection(state)!;
    expect(locked.graph!.nodes.map((item) => item.locked)).toEqual([true, true]);

    const unlocked = toggleLockSelection({ ...state, graph: locked.graph! })!;
    expect(unlocked.graph!.nodes.map((item) => item.locked)).toEqual([undefined, undefined]);
  });

  it("lays out unlocked nodes and leaves locked ones where they are", () => {
    const state = stateOf([
      node("a", 0, 0, { locked: true }),
      node("b", 300, 0),
      node("c", 600, 0),
    ]);

    const edit = applyLayout(
      state,
      { a: { x: 900, y: 900 }, b: { x: 0, y: 0 }, c: { x: 600, y: 300 } },
      "Tidied",
    );

    const positions = edit.graph!.nodes.map((item) => item.position);
    expect(positions[0]).toEqual({ x: 0, y: 0 });
    // b landed on the locked node, so b yields instead of it.
    expect(positions[1]!.y).toBeGreaterThanOrEqual(60 + 24);
    expect(positions[2]).toEqual({ x: 600, y: 300 });
  });
});

import { describe, expect, it } from "vitest";

import {
  createNoteGraph,
  createNoteGraphNode,
  duplicateNoteGraphNode,
  normalizeNoteGraphEdges,
} from "../noteGraph";
import { noteGraphFrameDefaultSize } from "../noteGraphFrames";
import { noteGraphTextNodeDefaultSize } from "../noteGraphGeometry";
import { noteGraphNodeDefaultSize } from "@loam/shared/notes/noteGraphGeometry";

describe("noteGraph", () => {
  it("creates shaped nodes with stable default geometry", () => {
    const node = createNoteGraphNode("decision", { x: 340, y: 80 });

    expect(node).toMatchObject({
      title: "New node",
      shape: "decision",
      size: noteGraphNodeDefaultSize,
      position: { x: 340, y: 80 },
    });
  });

  it("creates text objects with their own default size", () => {
    const text = createNoteGraphNode("text", { x: 0, y: 0 });
    expect(text.shape).toBe("text");
    expect(text.size).toEqual(noteGraphTextNodeDefaultSize);
    const frame = createNoteGraphNode("frame", { x: 0, y: 0 });
    expect(frame.shape).toBe("frame");
    expect(frame.size).toEqual(noteGraphFrameDefaultSize);
  });

  it("starts a new graph with one node named after the note", () => {
    expect(createNoteGraph({ title: " Trip " }).nodes).toEqual([
      expect.objectContaining({ title: "Trip", shape: "process" }),
    ]);
    expect(createNoteGraph({ title: "" }).nodes[0]?.title).toBe("Start here");
  });

  it("removes missing, self, and duplicate directed connections", () => {
    const nodes = [
      { id: "a", title: "A", position: { x: 0, y: 0 } },
      { id: "b", title: "B", position: { x: 10, y: 10 } },
    ];
    const edges = normalizeNoteGraphEdges(
      [
        { id: "valid", source: "a", target: "b" },
        { id: "duplicate", source: "a", target: "b" },
        { id: "self", source: "a", target: "a" },
        { id: "missing", source: "a", target: "missing" },
        { id: "reverse", source: "b", target: "a" },
      ],
      nodes,
    );

    expect(edges.map((edge) => edge.id)).toEqual(["valid", "reverse"]);
  });

  it("copies heading connections when a node is duplicated", () => {
    const duplicated = duplicateNoteGraphNode(
      {
        id: "node-1",
        title: "Setup",
        position: { x: 10, y: 20 },
        headingBlockIds: ["heading-1", "heading-2"],
      },
      "node-copy",
    );

    expect(duplicated).toEqual({
      id: "node-copy",
      title: "Setup (1)",
      position: { x: 42, y: 52 },
      headingBlockIds: ["heading-1", "heading-2"],
    });
  });
});

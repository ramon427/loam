import { describe, expect, it } from "vitest";

import type { NoteGraphEdge, NoteGraphNode } from "@loam/shared/notes/noteModel";
import { buildNoteGraphJsonCanvas, parseNoteGraphJsonCanvas } from "../noteGraphJsonCanvas";

describe("JSON Canvas conversion", () => {
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

  it("round-trips JSON Canvas export and import", () => {
    const nodes = [
      nodeAt("a", 0, 0, { title: "Alpha", notes: "detail" }),
      nodeAt("f", 500, 0, { shape: "frame", title: "Group" }),
    ];
    const edges: NoteGraphEdge[] = [{ id: "e", source: "a", target: "f", label: "in" }];
    const canvas = buildNoteGraphJsonCanvas({ nodes, edges });
    const parsed = parseNoteGraphJsonCanvas(canvas);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes.find((node) => node.title === "Alpha")?.notes).toBe("detail");
    expect(parsed.nodes.find((node) => node.title === "Group")?.shape).toBe("frame");
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.edges[0]?.label).toBe("in");
    const nodeIds = new Set(parsed.nodes.map((node) => node.id));
    expect(nodeIds.has(parsed.edges[0]!.source)).toBe(true);
    expect(nodeIds.has(parsed.edges[0]!.target)).toBe(true);
  });

  it("keeps image nodes as JSON Canvas file references through export and import", () => {
    const imagePath = "user-1/notes/note-1/chart.png";
    const canvas = buildNoteGraphJsonCanvas({
      nodes: [
        nodeAt("a", 0, 0, { title: "Alpha" }),
        nodeAt("i", 300, 0, { shape: "image", title: "Image", imageUrl: imagePath }),
      ],
      edges: [],
    });
    expect(JSON.parse(canvas).nodes[1]).toMatchObject({ type: "file", file: imagePath });

    const parsed = parseNoteGraphJsonCanvas(canvas);
    expect(parsed.nodes.find((node) => node.shape === "image")?.imageUrl).toBe(imagePath);

    // Other files, or images outside app storage, never become loadable images.
    const foreign = parseNoteGraphJsonCanvas(
      JSON.stringify({
        nodes: [
          { id: "md", type: "file", file: "Ideas/Plan.md", x: 0, y: 0 },
          { id: "web", type: "file", file: "https://example.com/a.png", x: 0, y: 0 },
        ],
      }),
    );
    expect(foreign.nodes.map((node) => [node.shape, node.title, node.imageUrl])).toEqual([
      ["process", "Plan.md", undefined],
      ["process", "a.png", undefined],
    ]);
  });

  it("rejects invalid JSON Canvas input with a readable error", () => {
    expect(() => parseNoteGraphJsonCanvas("{}")).toThrow(/nodes array/);
    expect(() => parseNoteGraphJsonCanvas("not json")).toThrow();
  });
});

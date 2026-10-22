import { describe, expect, it } from "vitest";

import type { NoteGraph, NoteGraphNode } from "@loam/shared/notes/noteModel";

import { buildNoteGraphSvg, noteGraphExportBounds } from "../noteGraphSvg";
import { createNoteGraphSnapshotScene } from "../noteGraphSnapshotScene";

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

describe("buildNoteGraphSvg", () => {
  it("exports nodes, connectors, arrows and escaped text", () => {
    const svg = buildNoteGraphSvg({
      nodes: [
        nodeAt("a", 0, 0, { title: "A & B <test>" }),
        nodeAt("b", 400, 0, { shape: "frame", title: "Group" }),
      ],
      edges: [{ id: "e", source: "a", target: "b", label: "leads", dashed: true }],
    });
    expect(svg).toContain("<svg");
    expect(svg).toContain("A &amp; B");
    expect(svg).toContain("&lt;test&gt;");
    expect(svg).toContain('stroke-dasharray="7 5"');
    expect(svg).toContain("marker-end");
    expect(svg).toContain("leads");
    expect(svg).not.toContain("foreignObject");
  });

  it("leaves out the members of a collapsed frame, as the canvas does", () => {
    const graph: Pick<NoteGraph, "nodes" | "edges"> = {
      nodes: [
        nodeAt("frame", 0, 0, {
          shape: "frame",
          title: "Folded",
          collapsed: true,
          size: { width: 224, height: 44 },
          expandedSize: { width: 400, height: 300 },
        }),
        nodeAt("member", 50, 100, { title: "Hidden member" }),
        nodeAt("peer", 2000, 50, { title: "Peer" }),
      ],
      edges: [{ id: "e", source: "member", target: "peer", label: "gone" }],
    };
    const svg = buildNoteGraphSvg(graph);

    expect(svg).toContain("Folded");
    expect(svg).toContain("Peer");
    expect(svg).not.toContain("Hidden member");
    expect(svg).not.toContain("gone");
  });

  it("routes connectors along the same paths as the snapshot scene", () => {
    const graph: Pick<NoteGraph, "nodes" | "edges"> = {
      nodes: [nodeAt("a", 0, 0), nodeAt("b", 300, 200), nodeAt("c", 600, 0)],
      edges: [
        { id: "ab", source: "a", target: "b" },
        { id: "bc", source: "b", target: "c", type: "bezier" },
      ],
    };
    const scene = createNoteGraphSnapshotScene(graph, noteGraphExportBounds(graph));
    const svg = buildNoteGraphSvg(graph);

    expect(scene.edges).toHaveLength(2);
    for (const { path } of scene.edges) expect(svg).toContain(`<path d="${path}"`);
  });
});

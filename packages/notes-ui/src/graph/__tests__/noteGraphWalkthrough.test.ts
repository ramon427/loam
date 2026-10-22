import { describe, expect, it } from "vitest";

import { buildNoteGraphWalkthroughOrder } from "../noteGraphQuery";
import type { NoteGraphEdge, NoteGraphNode } from "@loam/shared/notes/noteModel";

const nodeAt = (id: string, x: number, y: number): NoteGraphNode => ({
  id,
  title: id,
  position: { x, y },
  size: { width: 100, height: 50 },
});

const edge = (source: string, target: string): NoteGraphEdge => ({
  id: `${source}-${target}`,
  source,
  target,
});

describe("buildNoteGraphWalkthroughOrder", () => {
  it("returns an empty order for an empty graph", () => {
    expect(buildNoteGraphWalkthroughOrder([], [])).toEqual([]);
  });

  it("walks roots first, then children by position, then leftover nodes", () => {
    const root = nodeAt("root", 0, 0);
    const childLeft = nodeAt("child-left", 0, 80);
    const childRight = nodeAt("child-right", 120, 80);
    const orphan = nodeAt("orphan", 0, 200);
    expect(
      buildNoteGraphWalkthroughOrder(
        [orphan, childRight, childLeft, root],
        [edge("root", "child-right"), edge("root", "child-left")],
      ),
    ).toEqual(["root", "child-left", "child-right", "orphan"]);
  });
});

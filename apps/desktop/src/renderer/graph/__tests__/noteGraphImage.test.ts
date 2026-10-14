import { describe, expect, it } from "vitest";

import { noteGraphImageSize } from "../noteGraphImage";
import type { NoteGraphNode } from "@loam/shared/notes/noteModel";

const node = (id: string, x: number, y: number): NoteGraphNode => ({
  id,
  title: id,
  position: { x, y },
  size: { width: 200, height: 100 },
});

describe("graph image export size", () => {
  it("draws a small graph at twice its size, with padding", () => {
    expect(noteGraphImageSize({ nodes: [node("a", 0, 0)], edges: [] })).toEqual({
      width: (200 + 96) * 2,
      height: (100 + 96) * 2,
    });
  });

  it("scales a huge graph down so no side passes 8192 pixels, keeping its proportions", () => {
    const size = noteGraphImageSize({
      nodes: [node("a", 0, 0), node("b", 40_000, 9_000)],
      edges: [],
    })!;

    expect(size.width).toBe(8192);
    expect(size.height).toBeLessThan(8192);
    expect(size.width / size.height).toBeCloseTo((40_200 + 96) / (9_100 + 96), 2);
  });

  it("refuses bounds that cannot be drawn", () => {
    expect(noteGraphImageSize({ nodes: [node("a", Number.NaN, 0)], edges: [] })).toBeNull();
  });
});

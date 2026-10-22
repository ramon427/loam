import { describe, expect, it } from "vitest";

import { fitNoteGraphViewport } from "../noteGraphFitView";
import type { NoteGraphNode } from "@loam/shared/notes/noteModel";

const node = (id: string, x: number, y: number, extra: Partial<NoteGraphNode> = {}) => ({
  id,
  title: id,
  position: { x, y },
  size: { width: 224, height: 84 },
  ...extra,
});

const pane = { width: 736, height: 999 };

/** Where a flow point lands on screen under a viewport. */
const onScreen = (viewport: { x: number; y: number; zoom: number }, x: number, y: number) => ({
  x: x * viewport.zoom + viewport.x,
  y: y * viewport.zoom + viewport.y,
});

describe("fitting the view", () => {
  it("fits every drawn node, including ones far off screen, inside the pane", () => {
    const viewport = fitNoteGraphViewport([node("near", 80, 80), node("far", 978, 464)], pane)!;

    const topLeft = onScreen(viewport, 80, 80);
    const bottomRight = onScreen(viewport, 978 + 224, 464 + 84);
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(pane.width);
    expect(bottomRight.y).toBeLessThanOrEqual(pane.height);
  });

  it("ignores the hidden members of a collapsed frame", () => {
    const frame = node("frame", 0, 0, {
      shape: "frame",
      collapsed: true,
      size: { width: 200, height: 44 },
      expandedSize: { width: 3000, height: 3000 },
    });
    const withMember = fitNoteGraphViewport([frame, node("member", 2000, 2000)], pane);
    const alone = fitNoteGraphViewport([frame], pane);

    expect(withMember).toEqual(alone);
  });

  it("has nothing to fit without nodes or without a pane size", () => {
    expect(fitNoteGraphViewport([], pane)).toBeNull();
    expect(fitNoteGraphViewport([node("a", 0, 0)], { width: 0, height: 0 })).toBeNull();
  });
});

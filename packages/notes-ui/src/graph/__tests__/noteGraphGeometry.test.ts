import { describe, expect, it } from "vitest";

import { noteGraphNodeSizeLimits } from "@loam/shared/notes/noteGraphGeometry";
import {
  getKeyboardResizedSize,
  getNoteGraphBounds,
  NOTE_GRAPH_GRID,
  resolveNoteGraphEdgeHandles,
  snapNoteGraphNodeSizeToGrid,
} from "../noteGraphGeometry";
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

describe("noteGraphGeometry", () => {
  it("keeps every size limit on the resize grid", () => {
    const { minWidth, maxWidth, minHeight, maxHeight } = noteGraphNodeSizeLimits;
    for (const limit of [minWidth, maxWidth, minHeight, maxHeight]) {
      expect(limit % NOTE_GRAPH_GRID).toBe(0);
    }
  });

  it("snaps sizes to the resize grid and clamps to the limits", () => {
    expect(snapNoteGraphNodeSizeToGrid({ width: 281, height: 119 })).toEqual({
      width: 288,
      height: 112,
    });
    expect(snapNoteGraphNodeSizeToGrid({ width: 40, height: 9000 })).toEqual({
      width: noteGraphNodeSizeLimits.minWidth,
      height: noteGraphNodeSizeLimits.maxHeight,
    });
    // Already-aligned sizes pass through untouched.
    expect(snapNoteGraphNodeSizeToGrid({ width: 224, height: 96 })).toEqual({
      width: 224,
      height: 96,
    });
  });

  const keyboardResizeStart = { width: 224, height: 96 };
  const atMinSize = {
    width: noteGraphNodeSizeLimits.minWidth,
    height: noteGraphNodeSizeLimits.minHeight,
  };
  const nearMaxSize = {
    width: noteGraphNodeSizeLimits.maxWidth - 8,
    height: noteGraphNodeSizeLimits.maxHeight - 8,
  };

  it.each<{
    start: { width: number; height: number };
    direction: Parameters<typeof getKeyboardResizedSize>[1];
    step?: number;
    expected: { width: number; height: number };
  }>([
    { start: keyboardResizeStart, direction: "right", expected: { width: 240, height: 96 } },
    { start: keyboardResizeStart, direction: "left", expected: { width: 208, height: 96 } },
    { start: keyboardResizeStart, direction: "down", expected: { width: 224, height: 112 } },
    { start: keyboardResizeStart, direction: "up", expected: { width: 224, height: 80 } },
    {
      start: keyboardResizeStart,
      direction: "right",
      step: NOTE_GRAPH_GRID * 4,
      expected: { width: 288, height: 96 },
    },
    // Pinned at the limits instead of overshooting.
    { start: atMinSize, direction: "left", expected: atMinSize },
    { start: atMinSize, direction: "up", expected: atMinSize },
    {
      start: nearMaxSize,
      direction: "right",
      expected: { width: noteGraphNodeSizeLimits.maxWidth, height: nearMaxSize.height },
    },
    {
      start: nearMaxSize,
      direction: "down",
      expected: { width: nearMaxSize.width, height: noteGraphNodeSizeLimits.maxHeight },
    },
  ])(
    "resizes $start.width x $start.height $direction from the keyboard in grid steps",
    ({ start, direction, step, expected }) => {
      expect(getKeyboardResizedSize(start, direction, step)).toEqual(expected);
    },
  );

  it("resolves edge handles toward the connected node", () => {
    const source = { position: { x: 0, y: 0 }, size: { width: 200, height: 100 } };
    const right = { position: { x: 400, y: 20 }, size: { width: 200, height: 100 } };
    const below = { position: { x: 0, y: 400 }, size: { width: 200, height: 100 } };
    const above = { position: { x: 0, y: -400 }, size: { width: 200, height: 100 } };

    expect(resolveNoteGraphEdgeHandles(source, right)).toEqual({
      sourceHandle: "right-source",
      targetHandle: "left-target",
    });
    expect(resolveNoteGraphEdgeHandles(source, below)).toEqual({
      sourceHandle: "bottom-source",
      targetHandle: "top-target",
    });
    expect(resolveNoteGraphEdgeHandles(source, above)).toEqual({
      sourceHandle: "top-source",
      targetHandle: "bottom-target",
    });
    expect(resolveNoteGraphEdgeHandles(right, source)).toEqual({
      sourceHandle: "left-source",
      targetHandle: "right-target",
    });
  });

  it("computes graph bounds with padding", () => {
    const bounds = getNoteGraphBounds(
      [nodeAt("a", 100, 100, { size: { width: 100, height: 50 } })],
      40,
    );
    expect(bounds).toEqual({ x: 60, y: 60, width: 180, height: 130 });
  });
});

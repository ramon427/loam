import { describe, expect, it } from "vitest";

import {
  findCollapsedFrameHiddenNodeIds,
  findNoteGraphFrameMemberIds,
  noteGraphFrameCollapsedHeight,
} from "../noteGraphFrames";
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

describe("noteGraphFrames", () => {
  it("computes frame membership geometrically and hides collapsed members", () => {
    const frame = nodeAt("frame", 0, 0, {
      shape: "frame",
      size: { width: 400, height: 300 },
    });
    const inside = nodeAt("inside", 50, 50);
    const outside = nodeAt("outside", 900, 900);
    const nestedFrame = nodeAt("nested", 60, 60, { shape: "frame" });
    const nodes = [frame, inside, outside, nestedFrame];
    expect(findNoteGraphFrameMemberIds(nodes, frame)).toEqual(["inside"]);
    const collapsed = { ...frame, collapsed: true };
    expect(Array.from(findCollapsedFrameHiddenNodeIds([collapsed, inside, outside]))).toEqual([
      "inside",
    ]);
  });

  it("measures collapsed frame membership on the rect the frame restores", () => {
    const expandedSize = { width: 400, height: 300 };
    const frame = nodeAt("frame", 0, 0, { shape: "frame", size: expandedSize });
    // Center inside the expanded rect, far below the collapsed title bar.
    const deep = nodeAt("deep", 40, 240);
    const collapsed = {
      ...frame,
      collapsed: true,
      expandedSize,
      size: { width: 224, height: noteGraphFrameCollapsedHeight },
    };
    const otherFrame = {
      ...nodeAt("other-frame", 800, 0, { shape: "frame", size: expandedSize }),
      collapsed: true,
      expandedSize,
      size: { width: 224, height: noteGraphFrameCollapsedHeight },
    };
    const otherDeep = nodeAt("other-deep", 840, 240);
    expect(
      findNoteGraphFrameMemberIds([collapsed, deep, otherFrame, otherDeep], collapsed),
    ).toEqual(["deep"]);
    // Every collapsed frame keeps hiding its own members.
    expect(
      Array.from(findCollapsedFrameHiddenNodeIds([collapsed, deep, otherFrame, otherDeep])).sort(),
    ).toEqual(["deep", "other-deep"]);
    // Legacy collapsed frames without a stored rect fall back to their size.
    const legacy = { ...frame, collapsed: true };
    expect(findNoteGraphFrameMemberIds([legacy, deep], legacy)).toEqual(["deep"]);
  });
});

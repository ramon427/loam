/** Frames: their sizes, collapsing to a title bar, and which nodes sit inside one. */
import { getNoteGraphNodeSize } from "@loam/shared/notes/noteGraphGeometry";
import type { NoteGraphNode, NoteGraphNodeSize } from "@loam/shared/notes/noteModel";

import { getNoteGraphNodeCenter } from "./noteGraphGeometry";

export const noteGraphFrameDefaultSize = {
  width: 480,
  height: 320,
} as const;

export const noteGraphFrameCollapsedHeight = 44;

export const isNoteGraphFrameNode = (node: Pick<NoteGraphNode, "shape">): boolean =>
  node.shape === "frame";

/** Title-bar geometry a collapsed frame renders in place of its expanded rect. */
export const resolveNoteGraphFrameBarSize = (
  frame: Pick<NoteGraphNode, "title">,
): NoteGraphNodeSize => {
  const title = frame.title.trim() || "Group";
  return {
    width: Math.max(200, title.length * 9 + 140),
    height: noteGraphFrameCollapsedHeight,
  };
};

/**
 * Rect that frame membership is measured against. A collapsed frame keeps only
 * its title bar in `size`, so membership resolves the expanded rect instead;
 * otherwise hiding members, member counts, and dragging a frame together with
 * its members all change the moment the frame collapses.
 */
const resolveNoteGraphFrameMembershipSize = (
  frame: Pick<NoteGraphNode, "size" | "collapsed" | "expandedSize">,
): NoteGraphNodeSize => {
  if (!frame.collapsed) return getNoteGraphNodeSize(frame);
  return frame.expandedSize ?? getNoteGraphNodeSize(frame);
};

/**
 * Frame membership is geometric: a node's center inside the frame's expanded
 * rect, which is where the members stay when the frame is collapsed.
 */
export const findNoteGraphFrameMemberIds = (
  nodes: NoteGraphNode[],
  frame: NoteGraphNode,
): string[] => {
  const size = resolveNoteGraphFrameMembershipSize(frame);
  const left = frame.position.x;
  const top = frame.position.y;
  const right = left + size.width;
  const bottom = top + size.height;
  return nodes
    .filter((node) => {
      if (node.id === frame.id || isNoteGraphFrameNode(node)) return false;
      const center = getNoteGraphNodeCenter(node);
      return center.x >= left && center.x <= right && center.y >= top && center.y <= bottom;
    })
    .map((node) => node.id);
};

/** Nodes hidden because a containing frame is collapsed. */
export const findCollapsedFrameHiddenNodeIds = (nodes: NoteGraphNode[]): Set<string> => {
  const hidden = new Set<string>();
  nodes.forEach((frame) => {
    if (!isNoteGraphFrameNode(frame) || !frame.collapsed) return;
    findNoteGraphFrameMemberIds(nodes, frame).forEach((id) => hidden.add(id));
  });
  return hidden;
};

import {
  noteGraphNodeSizeLimits,
  getNoteGraphNodeSize,
} from "@loam/shared/notes/noteGraphGeometry";
import type { NoteGraphEdge, NoteGraphNode, NoteGraphNodeSize } from "@loam/shared/notes/noteModel";
import { clamp } from "../lib/clamp";

/** The canvas grid: dragged nodes snap to it, and resizes keep sizes on it. */
export const NOTE_GRAPH_GRID = 16;

/** Spacing of the drawn grid: the snap grid while snapping, a looser one otherwise. */
export const noteGraphGridGap = (snap: boolean) => (snap ? NOTE_GRAPH_GRID : 24);

const snapLengthToGrid = (value: number, min: number, max: number, grid: number) =>
  clamp(Math.round(value / grid) * grid, min, max);

export const snapNoteGraphNodeSizeToGrid = (
  size: NoteGraphNodeSize,
  grid: number = NOTE_GRAPH_GRID,
): NoteGraphNodeSize => ({
  width: snapLengthToGrid(
    size.width,
    noteGraphNodeSizeLimits.minWidth,
    noteGraphNodeSizeLimits.maxWidth,
    grid,
  ),
  height: snapLengthToGrid(
    size.height,
    noteGraphNodeSizeLimits.minHeight,
    noteGraphNodeSizeLimits.maxHeight,
    grid,
  ),
});

export type NoteGraphResizeDirection = "left" | "right" | "up" | "down";

export const getKeyboardResizedSize = (
  size: NoteGraphNodeSize,
  direction: NoteGraphResizeDirection,
  step: number = NOTE_GRAPH_GRID,
): NoteGraphNodeSize => {
  const grows = direction === "right" || direction === "down";
  const delta = grows ? step : -step;
  // Snap only the axis the key press changes; an off-grid size on the other
  // axis must not drift.
  if (direction === "left" || direction === "right") {
    return {
      width: snapLengthToGrid(
        size.width + delta,
        noteGraphNodeSizeLimits.minWidth,
        noteGraphNodeSizeLimits.maxWidth,
        NOTE_GRAPH_GRID,
      ),
      height: size.height,
    };
  }
  return {
    width: size.width,
    height: snapLengthToGrid(
      size.height + delta,
      noteGraphNodeSizeLimits.minHeight,
      noteGraphNodeSizeLimits.maxHeight,
      NOTE_GRAPH_GRID,
    ),
  };
};

type NoteGraphEdgeHandleIds = {
  sourceHandle: string;
  targetHandle: string;
};

export const getNoteGraphNodeCenter = (node: Pick<NoteGraphNode, "position" | "size">) => {
  const size = getNoteGraphNodeSize(node);
  return {
    x: node.position.x + size.width / 2,
    y: node.position.y + size.height / 2,
  };
};

export type NoteGraphSide = "top" | "right" | "bottom" | "left";

/** The side a connector handle id ("right-source", "top-target", ...) sits on. */
export const getNoteGraphHandleSide = (handleId: string | undefined): NoteGraphSide => {
  if (handleId?.startsWith("right")) return "right";
  if (handleId?.startsWith("bottom")) return "bottom";
  if (handleId?.startsWith("left")) return "left";
  return "top";
};

/** The middle of one side of a node, where connectors attach. */
export const getNoteGraphNodeAnchor = (
  node: Pick<NoteGraphNode, "position" | "size">,
  side: NoteGraphSide,
) => {
  const size = getNoteGraphNodeSize(node);
  const { x, y } = node.position;
  if (side === "right") return { x: x + size.width, y: y + size.height / 2 };
  if (side === "bottom") return { x: x + size.width / 2, y: y + size.height };
  if (side === "left") return { x, y: y + size.height / 2 };
  return { x: x + size.width / 2, y };
};

/** Halfway between the centres of a connector's nodes, or null when either is missing. */
export const getNoteGraphEdgeMidpoint = (
  nodes: readonly NoteGraphNode[],
  edge: Pick<NoteGraphEdge, "source" | "target">,
) => {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  if (!source || !target) return null;
  const from = getNoteGraphNodeCenter(source);
  const to = getNoteGraphNodeCenter(target);
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
};

/**
 * Pick the side handles that face the connected node so arrows leave and
 * arrive on the closest sides instead of stacking on a single handle.
 */
export const resolveNoteGraphEdgeHandles = (
  source: Pick<NoteGraphNode, "position"> & {
    size?: NoteGraphNodeSize;
  },
  target: Pick<NoteGraphNode, "position"> & {
    size?: NoteGraphNodeSize;
  },
): NoteGraphEdgeHandleIds => {
  const sourceCenter = getNoteGraphNodeCenter(source);
  const targetCenter = getNoteGraphNodeCenter(target);
  const deltaX = targetCenter.x - sourceCenter.x;
  const deltaY = targetCenter.y - sourceCenter.y;
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX >= 0
      ? { sourceHandle: "right-source", targetHandle: "left-target" }
      : { sourceHandle: "left-source", targetHandle: "right-target" };
  }
  return deltaY >= 0
    ? { sourceHandle: "bottom-source", targetHandle: "top-target" }
    : { sourceHandle: "top-source", targetHandle: "bottom-target" };
};

export const noteGraphTextNodeDefaultSize = {
  width: 200,
  height: 48,
} as const;

export const getNoteGraphBounds = (
  nodes: NoteGraphNode[],
  padding = 40,
): {
  x: number;
  y: number;
  width: number;
  height: number;
} => {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 640, height: 480 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  nodes.forEach((node) => {
    const size = getNoteGraphNodeSize(node);
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + size.width);
    maxY = Math.max(maxY, node.position.y + size.height);
  });
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
};

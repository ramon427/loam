import type { NoteGraphSnapshot, NoteGraph, NoteGraphNode } from "@loam/shared/notes/noteModel";
import { getNoteGraphNodeSize } from "@loam/shared/notes/noteGraphGeometry";
import {
  getNoteGraphHandleSide,
  getNoteGraphNodeAnchor,
  resolveNoteGraphEdgeHandles,
  type NoteGraphSide,
} from "./noteGraphGeometry";
import { findCollapsedFrameHiddenNodeIds } from "./noteGraphFrames";
import { getBezierPath, getSmoothStepPath, getStraightPath, Position } from "@xyflow/react";

type Rect = Pick<NoteGraphSnapshot, "x" | "y" | "width" | "height">;
const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

const sidePositions: Record<NoteGraphSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

const anchor = (node: NoteGraphNode, handle: string) => {
  const side = getNoteGraphHandleSide(handle);
  return { ...getNoteGraphNodeAnchor(node, side), position: sidePositions[side] };
};

/** Cull off-crop nodes, retaining connectors whose routes cross the crop. */
export const createNoteGraphSnapshotScene = (
  graph: Pick<NoteGraph, "nodes" | "edges">,
  bounds: Rect,
) => {
  const hidden = findCollapsedFrameHiddenNodeIds(graph.nodes);
  const visible = graph.nodes.filter((node) => !hidden.has(node.id));
  const byId = new Map(visible.map((node) => [node.id, node]));
  const nodes = visible.filter((node) =>
    intersects({ ...node.position, ...getNoteGraphNodeSize(node) }, bounds),
  );
  const edges = graph.edges.flatMap((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) return [];
    const handles = resolveNoteGraphEdgeHandles(source, target);
    const start = anchor(source, handles.sourceHandle);
    const end = anchor(target, handles.targetHandle);
    // Bezier handles can extend beyond their endpoints; use a conservative margin.
    const margin =
      edge.type === "bezier"
        ? Math.max(128, Math.abs(start.x - end.x), Math.abs(start.y - end.y))
        : 48;
    if (
      !intersects(
        {
          x: Math.min(start.x, end.x) - margin,
          y: Math.min(start.y, end.y) - margin,
          width: Math.abs(start.x - end.x) + margin * 2,
          height: Math.abs(start.y - end.y) + margin * 2,
        },
        bounds,
      )
    )
      return [];
    const points = {
      sourceX: start.x,
      sourceY: start.y,
      sourcePosition: start.position,
      targetX: end.x,
      targetY: end.y,
      targetPosition: end.position,
    };
    const [path, labelX, labelY] =
      edge.type === "straight"
        ? getStraightPath(points)
        : edge.type === "bezier"
          ? getBezierPath(points)
          : getSmoothStepPath({ ...points, borderRadius: edge.type === "step" ? 0 : 5 });
    return [{ edge, path, labelX, labelY }];
  });
  return { nodes, edges };
};

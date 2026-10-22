import { getViewportForBounds } from "@xyflow/react";

import { getNoteGraphBounds } from "./noteGraphGeometry";
import { findCollapsedFrameHiddenNodeIds } from "./noteGraphFrames";
import type { NoteGraph, NoteGraphNode } from "@loam/shared/notes/noteModel";

type Viewport = NonNullable<NoteGraph["viewport"]>;

export const defaultViewport: Viewport = { x: 0, y: 0, zoom: 0.85 };

/** How React Flow fits nodes when the canvas has no size to compute a viewport from. */
export const noteGraphFitViewOptions = {
  padding: 0.18,
  maxZoom: 1.2,
  includeHiddenNodes: true,
} as const;

const FIT_MIN_ZOOM = 0.15;

export const areNoteGraphViewportsNearlyEqual = (left: Viewport, right: Viewport) =>
  Math.abs(left.x - right.x) < 0.5 &&
  Math.abs(left.y - right.y) < 0.5 &&
  Math.abs(left.zoom - right.zoom) < 0.001;

/**
 * The viewport that fits every drawn node into a pane of the given size, or null when there
 * is nothing to fit. It is computed from the graph rather than left to React Flow because
 * React Flow only measures nodes it has rendered, and it skips off-screen ones.
 */
export function fitNoteGraphViewport(
  nodes: readonly NoteGraphNode[],
  pane: { width: number; height: number },
): Viewport | null {
  const hidden = findCollapsedFrameHiddenNodeIds([...nodes]);
  const drawn = nodes.filter((node) => !hidden.has(node.id));
  if (drawn.length === 0 || pane.width <= 0 || pane.height <= 0) return null;
  const bounds = getNoteGraphBounds(drawn, 0);
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  return getViewportForBounds(
    bounds,
    pane.width,
    pane.height,
    FIT_MIN_ZOOM,
    noteGraphFitViewOptions.maxZoom,
    noteGraphFitViewOptions.padding,
  );
}

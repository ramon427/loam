import { getNoteGraphNodeSize } from "@loam/shared/notes/noteGraphGeometry";
import type { NoteGraph, NoteGraphEdge, NoteGraphNode } from "@loam/shared/notes/noteModel";

import { getNoteGraphEdgeMidpoint } from "./noteGraphGeometry";
import type { NoteGraphToolbarAnchor } from "./NoteGraphSelectionToolbar";

type Size = { width: number; height: number };

/** Half the height an edge's toolbar keeps clear around the edge's midpoint. */
const EDGE_ANCHOR_HALF_HEIGHT = 14;

/**
 * Where the selection toolbar points, in flow coordinates: over the middle of
 * the selected nodes' bounds, or of the selected edge. `measured` holds the
 * sizes nodes are drawn at, which can differ from the sizes they store.
 */
export const selectionToolbarAnchor = ({
  selectedNodes,
  selectedEdge,
  nodes,
  measured,
}: {
  selectedNodes: readonly NoteGraphNode[];
  selectedEdge: NoteGraphEdge | null;
  nodes: readonly NoteGraphNode[];
  measured: ReadonlyMap<string, Size>;
}): NoteGraphToolbarAnchor | null => {
  if (selectedNodes.length > 0) {
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const node of selectedNodes) {
      const size = measured.get(node.id) ?? getNoteGraphNodeSize(node);
      left = Math.min(left, node.position.x);
      right = Math.max(right, node.position.x + size.width);
      top = Math.min(top, node.position.y);
      bottom = Math.max(bottom, node.position.y + size.height);
    }
    return { x: (left + right) / 2, top, bottom };
  }
  if (selectedEdge) {
    const mid = getNoteGraphEdgeMidpoint(nodes, selectedEdge);
    return mid
      ? { x: mid.x, top: mid.y - EDGE_ANCHOR_HALF_HEIGHT, bottom: mid.y + EDGE_ANCHOR_HALF_HEIGHT }
      : null;
  }
  return null;
};

/** Where an edge's label editor opens: the edge's midpoint, or null when the edge is gone. */
export const edgeLabelEditorPoint = (graph: NoteGraph, edgeId: string) => {
  const edge = graph.edges.find((candidate) => candidate.id === edgeId);
  return edge ? getNoteGraphEdgeMidpoint(graph.nodes, edge) : null;
};

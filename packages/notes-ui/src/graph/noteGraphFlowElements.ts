/**
 * Turns the domain graph into the nodes and edges React Flow draws. React Flow never owns
 * graph data: these elements are rebuilt from the graph, the selection and what is
 * happening on the canvas right now (a drag, a resize, search highlights).
 */
import { MarkerType, SelectionMode, type Edge, type Node } from "@xyflow/react";

import { getNoteGraphNodeSize } from "@loam/shared/notes/noteGraphGeometry";

import { resolveNoteGraphEdgeHandles } from "./noteGraphGeometry";
import { noteGraphEdgeDefaultWidth, resolveNoteGraphEdgePaint } from "./noteGraphPaint";
import type {
  NoteGraph,
  NoteGraphEdge,
  NoteGraphEdgeType,
  NoteGraphNode,
} from "@loam/shared/notes/noteModel";

export type GraphFlowNode = Node<{ node: NoteGraphNode }, "noteGraph">;
export type GraphFlowEdge = Edge<{ edge: NoteGraphEdge }>;

type Point = { x: number; y: number };
type Size = { width: number; height: number };

/** Canvas state that is not part of the graph yet: a node mid-drag or mid-resize. */
export type NoteGraphTransientNode = { position?: Point; size?: Size };

export type NoteGraphNodeDecoration = "dimmed" | "highlighted" | "connect-candidate" | "new";

const decorationClassNames: Record<NoteGraphNodeDecoration, string> = {
  dimmed: "note-graph-node-dimmed",
  highlighted: "note-graph-node-highlighted",
  "connect-candidate": "note-graph-connect-candidate",
  new: "note-graph-node-enter",
};

/**
 * How each node is marked: dimmed when filtered out or, in focus mode, when it is not the
 * selection or one of its neighbours; highlighted when it matches the search; the keyboard
 * connect target; and briefly, nodes that were just added.
 */
export function noteGraphDecorations({
  graph,
  filteredOutIds,
  focusIds,
  matchIds,
  connectTargetId,
  newNodeIds,
}: {
  graph: Pick<NoteGraph, "nodes" | "edges">;
  filteredOutIds: ReadonlySet<string>;
  /** In focus mode, the selected nodes. */
  focusIds: ReadonlySet<string> | null;
  matchIds: readonly string[];
  connectTargetId: string | null;
  newNodeIds: ReadonlySet<string>;
}) {
  const dimmedIds = new Set(filteredOutIds);
  if (focusIds && focusIds.size > 0) {
    const kept = new Set(focusIds);
    for (const edge of graph.edges) {
      if (focusIds.has(edge.source)) kept.add(edge.target);
      if (focusIds.has(edge.target)) kept.add(edge.source);
    }
    for (const node of graph.nodes) if (!kept.has(node.id)) dimmedIds.add(node.id);
  }
  const decorations = new Map<string, NoteGraphNodeDecoration[]>();
  const add = (id: string, decoration: NoteGraphNodeDecoration) =>
    decorations.set(id, [...(decorations.get(id) ?? []), decoration]);
  dimmedIds.forEach((id) => add(id, "dimmed"));
  matchIds.forEach((id) => add(id, "highlighted"));
  if (connectTargetId) add(connectTargetId, "connect-candidate");
  newNodeIds.forEach((id) => add(id, "new"));
  return { dimmedIds, decorations };
}

export function toFlowNodes({
  nodes,
  hiddenIds,
  selectedIds,
  measured,
  transient,
  decorations,
}: {
  nodes: readonly NoteGraphNode[];
  hiddenIds: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  /** Sizes React Flow measured; handing them back keeps it from measuring again. */
  measured: ReadonlyMap<string, Size>;
  transient: ReadonlyMap<string, NoteGraphTransientNode>;
  decorations: ReadonlyMap<string, readonly NoteGraphNodeDecoration[]>;
}): GraphFlowNode[] {
  return nodes.map((node) => {
    const live = transient.get(node.id);
    const size = live?.size ?? getNoteGraphNodeSize(node);
    const classes = decorations.get(node.id)?.map((decoration) => decorationClassNames[decoration]);
    const hidden = hiddenIds.has(node.id);
    return {
      id: node.id,
      type: "noteGraph",
      position: live?.position ?? node.position,
      data: { node },
      draggable: !node.locked,
      hidden,
      selected: selectedIds.has(node.id) && !hidden,
      width: size.width,
      height: size.height,
      measured: measured.get(node.id),
      className: classes?.length ? classes.join(" ") : undefined,
    };
  });
}

export const edgeDefaults = {
  type: "smoothstep",
  selectable: true,
  focusable: true,
  // Wider invisible hit area so arrows are easy to select/delete.
  interactionWidth: 28,
  markerEnd: { type: MarkerType.ArrowClosed, color: "var(--app-muted)", width: 16, height: 16 },
  style: { stroke: "var(--app-muted)", strokeWidth: noteGraphEdgeDefaultWidth },
  labelStyle: { fill: "var(--app-text)", fontSize: 11, fontWeight: 600 },
  labelBgStyle: { fill: "var(--app-page)", fillOpacity: 0.96 },
  labelBgPadding: [8, 4] as [number, number],
  labelBgBorderRadius: 4,
} satisfies Partial<GraphFlowEdge>;

export const connectionLineStyle = {
  stroke: "var(--app-muted)",
  strokeWidth: noteGraphEdgeDefaultWidth,
} as const;

const flowEdgeTypes: Record<NoteGraphEdgeType, string> = {
  smoothstep: "smoothstep",
  bezier: "default",
  straight: "straight",
  step: "step",
};

const arrowMarker = (color: string) => ({
  type: MarkerType.ArrowClosed,
  color,
  width: 16,
  height: 16,
});

export function toFlowEdge(
  edge: NoteGraphEdge,
  {
    selected,
    hidden,
    nodesById,
    dimmed = false,
    lowZoom = false,
  }: {
    selected: boolean;
    hidden: boolean;
    nodesById: ReadonlyMap<string, NoteGraphNode>;
    dimmed?: boolean;
    /** Far zoomed out, connectors draw as plain straight lines without labels. */
    lowZoom?: boolean;
  },
): GraphFlowEdge {
  const source = nodesById.get(edge.source);
  const target = nodesById.get(edge.target);
  const paint = resolveNoteGraphEdgePaint(edge, "var(--app-muted)");
  const stroke = selected ? "var(--app-accent)" : paint.stroke;
  const locked = Boolean(edge.locked);
  return {
    ...edgeDefaults,
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(source && target ? resolveNoteGraphEdgeHandles(source, target) : {}),
    label: lowZoom ? undefined : edge.label,
    type: lowZoom ? "straight" : flowEdgeTypes[edge.type ?? "smoothstep"],
    data: { edge },
    hidden,
    selected,
    selectable: !locked,
    focusable: !locked,
    className: dimmed ? "note-graph-edge-dimmed" : undefined,
    markerEnd: paint.arrowEnd ? arrowMarker(stroke) : undefined,
    markerStart: paint.arrowStart ? arrowMarker(stroke) : undefined,
    style: {
      stroke,
      strokeWidth: selected ? Math.max(2.4, paint.width + 0.6) : paint.width,
      ...(paint.dash ? { strokeDasharray: paint.dash } : {}),
    },
  };
}

export const noteGraphPanMouseButtons = [1];

/**
 * A left drag on empty canvas pans. Control/Command + drag draws a selection rectangle
 * (Shift + drag when read-only).
 */
export function resolveNoteGraphPointerInteraction(options: { readOnly: boolean }) {
  return {
    panOnDrag: true,
    selectionOnDrag: false,
    selectionKeyCode: options.readOnly ? "Shift" : ["Control", "Meta"],
    panActivationKeyCode: "Space" as const,
    selectionMode: SelectionMode.Partial,
    multiSelectionKeyCode: ["Shift", "Control", "Meta"],
  };
}

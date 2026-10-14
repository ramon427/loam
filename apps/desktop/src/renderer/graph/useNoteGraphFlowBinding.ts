import type {
  Connection,
  EdgeChange,
  FinalConnectionState,
  NodeChange,
  OnConnectStartParams,
  ReactFlowInstance,
} from "@xyflow/react";
import { useCallback, useRef, useState } from "react";

import { getNoteGraphNodeSize } from "@loam/shared/notes/noteGraphGeometry";

import type { GraphFlowEdge, GraphFlowNode, NoteGraphTransientNode } from "./noteGraphFlowElements";
import {
  findCollapsedFrameHiddenNodeIds,
  findNoteGraphFrameMemberIds,
  isNoteGraphFrameNode,
} from "./noteGraphFrames";
import {
  addConnectedNodeAt,
  connectNodes,
  duplicateNodesAt,
  moveNodes,
  updateEdge,
  type NoteGraphEdit,
  type NoteGraphSelection,
  type NoteGraphState,
} from "./noteGraphOps";
import { cycleNoteGraphEdgeType } from "./noteGraphConnectors";
import { useValueStore } from "./useValueStore";
import type { NoteGraph, NoteGraphNode } from "@loam/shared/notes/noteModel";

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type NoteGraphGuides = { x: number | null; y: number | null };

const noGuides: NoteGraphGuides = { x: null, y: null };
const GUIDE_SNAP_SCREEN_PX = 6;

/** The closest of `lines` to any of `edges` within `threshold`, as a delta and a guide. */
const nearestLine = (edges: number[], lines: number[], threshold: number) => {
  let best: { delta: number; line: number } | null = null;
  for (const line of lines) {
    for (const edge of edges) {
      const delta = line - edge;
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, line };
      }
    }
  }
  return best;
};

const spanOf = (start: number, length: number) => [start, start + length / 2, start + length];

/**
 * Where dragged nodes end up: Shift locks the drag to one axis, a single dragged node snaps
 * to the edges and centres of the nodes around it (shown as alignment guides), and a dragged
 * frame carries its members along.
 */
export function resolveDragPositions({
  proposed,
  primary,
  starts,
  frameMembers,
  others,
  axisLock,
  snapThreshold,
}: {
  /** Positions React Flow proposes for the dragged nodes. */
  proposed: ReadonlyMap<string, Point>;
  primary: { id: string; size: Size };
  starts: ReadonlyMap<string, Point>;
  frameMembers: ReadonlyMap<string, readonly string[]>;
  /** Drawn nodes that are not being dragged. */
  others: readonly NoteGraphNode[];
  axisLock: boolean;
  snapThreshold: number;
}): { positions: Map<string, Point>; guides: NoteGraphGuides } {
  const positions = new Map(proposed);
  let guides = noGuides;
  const position = positions.get(primary.id);
  const start = starts.get(primary.id);
  if (axisLock && position && start) {
    const keepX = Math.abs(position.x - start.x) < Math.abs(position.y - start.y);
    for (const [id, proposedPosition] of positions) {
      const nodeStart = starts.get(id);
      if (!nodeStart) continue;
      positions.set(
        id,
        keepX
          ? { x: nodeStart.x, y: proposedPosition.y }
          : { x: proposedPosition.x, y: nodeStart.y },
      );
    }
  } else if (proposed.size === 1 && position) {
    const linesX = others.flatMap((node) =>
      spanOf(node.position.x, getNoteGraphNodeSize(node).width),
    );
    const linesY = others.flatMap((node) =>
      spanOf(node.position.y, getNoteGraphNodeSize(node).height),
    );
    const snapX = nearestLine(spanOf(position.x, primary.size.width), linesX, snapThreshold);
    const snapY = nearestLine(spanOf(position.y, primary.size.height), linesY, snapThreshold);
    positions.set(primary.id, {
      x: position.x + (snapX?.delta ?? 0),
      y: position.y + (snapY?.delta ?? 0),
    });
    guides = { x: snapX?.line ?? null, y: snapY?.line ?? null };
  }
  for (const [frameId, members] of frameMembers) {
    const frame = positions.get(frameId);
    const frameStart = starts.get(frameId);
    if (!frame || !frameStart) continue;
    for (const memberId of members) {
      const memberStart = starts.get(memberId);
      if (!memberStart || proposed.has(memberId)) continue;
      positions.set(memberId, {
        x: memberStart.x + frame.x - frameStart.x,
        y: memberStart.y + frame.y - frameStart.y,
      });
    }
  }
  return { positions, guides };
}

/** React Flow reports drops on empty canvas with the pane as the event target. */
const isPaneTarget = (target: EventTarget | null) =>
  target instanceof Element && target.classList.contains("react-flow__pane");

type DragGesture = {
  starts: Map<string, Point>;
  frameMembers: Map<string, string[]>;
  /** Alt+drag leaves the originals and drops copies. */
  duplicate: boolean;
};

/**
 * Connects React Flow to the graph. React Flow's change events only feed what is happening
 * on the canvas right now (drag and resize previews, measured sizes, selection); a gesture
 * reaches the graph as one edit when it ends.
 */
export function useNoteGraphFlowBinding({
  readOnly,
  instance,
  getState,
  run,
  select,
  axisLock,
  onEditEdgeLabel,
  onMoveEnd,
  announce,
}: {
  readOnly: boolean;
  instance: ReactFlowInstance<GraphFlowNode, GraphFlowEdge> | null;
  getState: () => NoteGraphState;
  run: (operation: (state: NoteGraphState) => NoteGraphEdit | null) => NoteGraphEdit | null;
  select: (selection: NoteGraphSelection) => void;
  /** Shift is held: drags keep to one axis. */
  axisLock: boolean;
  onEditEdgeLabel: (edgeId: string) => void;
  onMoveEnd: (viewport: NonNullable<NoteGraph["viewport"]>) => void;
  announce: (message: string) => void;
}) {
  const [measured, setMeasured] = useState<ReadonlyMap<string, Size>>(() => new Map());
  const [transient, transientStore] = useValueStore<ReadonlyMap<string, NoteGraphTransientNode>>(
    () => new Map(),
  );
  const [guides, setGuides] = useState<NoteGraphGuides>(noGuides);
  const [reconnecting, setReconnecting] = useState(false);
  const dragRef = useRef<DragGesture | null>(null);
  const connectSourceRef = useRef<string | null>(null);

  const updateTransient = useCallback(
    (update: (draft: Map<string, NoteGraphTransientNode>) => void) => {
      const draft = new Map(transientStore.get());
      update(draft);
      transientStore.set(draft);
    },
    [transientStore],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<GraphFlowNode>[]) => {
      const resizing = new Set(
        changes.flatMap((change) =>
          change.type === "dimensions" && change.resizing ? [change.id] : [],
        ),
      );
      const sizes = changes.flatMap((change) =>
        change.type === "dimensions" && change.dimensions
          ? [{ id: change.id, size: change.dimensions, resizing: change.resizing }]
          : [],
      );
      if (sizes.length > 0) {
        setMeasured((current) => {
          const next = new Map(current);
          sizes.forEach(({ id, size }) => next.set(id, size));
          return next;
        });
      }
      const positions = changes.flatMap((change) =>
        change.type === "position" &&
        change.position &&
        (change.dragging || resizing.has(change.id))
          ? [{ id: change.id, position: change.position }]
          : [],
      );
      if (positions.length > 0 || sizes.some((entry) => entry.resizing !== undefined)) {
        updateTransient((draft) => {
          positions.forEach(({ id, position }) => draft.set(id, { ...draft.get(id), position }));
          sizes.forEach(({ id, size, resizing: active }) => {
            if (active) draft.set(id, { ...draft.get(id), size });
            else if (active === false) draft.delete(id);
          });
        });
      }
      const selectionChanges = changes.flatMap((change) =>
        change.type === "select" ? [change] : [],
      );
      if (selectionChanges.length > 0) {
        const current = getState().selection;
        const nodeIds = current.nodeIds.filter((id) =>
          selectionChanges.every((change) => change.id !== id || change.selected),
        );
        selectionChanges.forEach((change) => {
          if (change.selected && !nodeIds.includes(change.id)) nodeIds.push(change.id);
        });
        select({ nodeIds, edgeId: nodeIds.length > 0 ? null : current.edgeId });
      }
    },
    [getState, select, updateTransient],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<GraphFlowEdge>[]) => {
      const current = getState().selection;
      let edgeId = current.edgeId;
      changes.forEach((change) => {
        if (change.type !== "select") return;
        if (change.selected) edgeId = change.id;
        else if (change.id === edgeId) edgeId = null;
      });
      if (edgeId !== current.edgeId) select({ ...current, edgeId });
    },
    [getState, select],
  );

  const onNodeDragStart = useCallback(
    (event: MouseEvent | TouchEvent, node: GraphFlowNode, dragged: GraphFlowNode[]) => {
      const { graph } = getState();
      const draggedNodes = dragged.length > 0 ? dragged : [node];
      const starts = new Map(draggedNodes.map((item) => [item.id, item.data.node.position]));
      const frameMembers = new Map<string, string[]>();
      for (const item of draggedNodes) {
        if (!isNoteGraphFrameNode(item.data.node)) continue;
        const members = findNoteGraphFrameMemberIds(graph.nodes, item.data.node).filter(
          (id) => !starts.has(id),
        );
        frameMembers.set(item.id, members);
        for (const member of graph.nodes) {
          if (members.includes(member.id)) starts.set(member.id, member.position);
        }
      }
      dragRef.current = {
        starts,
        frameMembers,
        duplicate:
          !readOnly &&
          event instanceof MouseEvent &&
          event.altKey &&
          draggedNodes.every((item) => !item.data.node.locked),
      };
    },
    [getState, readOnly],
  );

  const onNodeDrag = useCallback(
    (_event: MouseEvent | TouchEvent, node: GraphFlowNode, dragged: GraphFlowNode[]) => {
      const drag = dragRef.current;
      if (!drag) return;
      const draggedNodes = dragged.length > 0 ? dragged : [node];
      const draggedIds = new Set(draggedNodes.map((item) => item.id));
      const { graph } = getState();
      const hidden = findCollapsedFrameHiddenNodeIds(graph.nodes);
      const { positions, guides: nextGuides } = resolveDragPositions({
        proposed: new Map(draggedNodes.map((item) => [item.id, item.position])),
        primary: { id: node.id, size: getNoteGraphNodeSize(node.data.node) },
        starts: drag.starts,
        // Copies leave the frame's members where they are.
        frameMembers: drag.duplicate ? new Map() : drag.frameMembers,
        others: graph.nodes.filter((item) => !draggedIds.has(item.id) && !hidden.has(item.id)),
        axisLock,
        snapThreshold: GUIDE_SNAP_SCREEN_PX / (instance?.getViewport().zoom ?? 1),
      });
      updateTransient((draft) => {
        positions.forEach((position, id) => draft.set(id, { ...draft.get(id), position }));
      });
      setGuides((current) =>
        current.x === nextGuides.x && current.y === nextGuides.y ? current : nextGuides,
      );
    },
    [axisLock, getState, instance, updateTransient],
  );

  const onNodeDragStop = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    setGuides(noGuides);
    const positions = new Map<string, Point>();
    for (const [id, live] of transientStore.get()) {
      if (live.position) positions.set(id, live.position);
    }
    updateTransient((draft) => {
      for (const id of positions.keys()) draft.delete(id);
    });
    if (!drag || readOnly || positions.size === 0) return;
    run((state) =>
      drag.duplicate ? duplicateNodesAt(state, positions) : moveNodes(state, positions),
    );
  }, [readOnly, run, transientStore, updateTransient]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      run((state) => connectNodes(state, connection.source, connection.target));
    },
    [run],
  );

  const onConnectStart = useCallback(
    (_event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
      connectSourceRef.current = params.nodeId ?? null;
    },
    [],
  );

  /** A connector dropped on empty canvas creates a connected node there. */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      const sourceId = connectSourceRef.current;
      connectSourceRef.current = null;
      if (connectionState.isValid || readOnly || !sourceId || !instance) return;
      if (!isPaneTarget(event.target)) return;
      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      if (!point) return;
      const center = instance.screenToFlowPosition(
        { x: point.clientX, y: point.clientY },
        { snapToGrid: false },
      );
      run((state) => addConnectedNodeAt(state, { sourceId, center }));
    },
    [instance, readOnly, run],
  );

  const onReconnect = useCallback(
    (oldEdge: GraphFlowEdge, connection: Connection) => {
      if (readOnly) return;
      run((state) =>
        updateEdge(state, oldEdge.id, { source: connection.source, target: connection.target }),
      );
    },
    [readOnly, run],
  );

  /** Shift+click cycles the connector style. */
  const onEdgeClick = useCallback(
    (event: React.MouseEvent, edge: GraphFlowEdge) => {
      const domainEdge = edge.data?.edge;
      if (!event.shiftKey || readOnly || !domainEdge || domainEdge.locked) return;
      const type = cycleNoteGraphEdgeType(domainEdge.type);
      if (run((state) => updateEdge(state, edge.id, { type }))?.graph) {
        announce(`Connector style: ${type}`);
      }
    },
    [announce, readOnly, run],
  );

  const onEdgeDoubleClick = useCallback(
    (event: React.MouseEvent, edge: GraphFlowEdge) => {
      // The pane's double-click creates a node; a connector is never empty canvas.
      event.stopPropagation();
      if (readOnly || edge.data?.edge.locked) return;
      event.preventDefault();
      onEditEdgeLabel(edge.id);
    },
    [onEditEdgeLabel, readOnly],
  );

  const handleMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: NonNullable<NoteGraph["viewport"]>) => {
      if (!readOnly) onMoveEnd(viewport);
    },
    [onMoveEnd, readOnly],
  );

  /** A resize gesture ended on a node card. */
  const clearTransientNode = useCallback(
    (nodeId: string) => updateTransient((draft) => void draft.delete(nodeId)),
    [updateTransient],
  );

  return {
    measured,
    transient,
    guides,
    reconnecting,
    clearTransientNode,
    flowProps: {
      onNodesChange,
      onEdgesChange,
      onNodeDragStart,
      onNodeDrag,
      onNodeDragStop,
      onConnect,
      onConnectStart,
      onConnectEnd,
      onReconnect,
      onReconnectStart: () => setReconnecting(true),
      onReconnectEnd: () => setReconnecting(false),
      onEdgeClick,
      onEdgeDoubleClick,
      onMoveEnd: handleMoveEnd,
    },
  };
}

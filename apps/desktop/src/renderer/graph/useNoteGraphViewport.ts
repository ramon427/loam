import { useOnViewportChange, useUpdateNodeInternals, type ReactFlowInstance } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { useReducedMotion } from "framer-motion";

import {
  areNoteGraphViewportsNearlyEqual,
  defaultViewport,
  fitNoteGraphViewport,
  noteGraphFitViewOptions,
} from "./noteGraphFitView";
import type { GraphFlowEdge, GraphFlowNode } from "./noteGraphFlowElements";
import { getNoteGraphBounds } from "./noteGraphGeometry";
import type { NoteGraph, NoteGraphNode } from "@loam/shared/notes/noteModel";

type Point = { x: number; y: number };
type Viewport = NonNullable<NoteGraph["viewport"]>;
type Instance = ReactFlowInstance<GraphFlowNode, GraphFlowEdge>;

/** The size of the React Flow surface inside the canvas, or null before it has one. */
const measurePane = (pane: HTMLElement | null) => {
  const flow = pane?.querySelector(".react-flow");
  const rect = (flow instanceof HTMLElement ? flow : pane)?.getBoundingClientRect();
  return rect && rect.width > 0 && rect.height > 0 ? rect : null;
};

const isMeasured = (node: GraphFlowNode) =>
  (node.measured?.width ?? 0) > 8 && (node.measured?.height ?? 0) > 8;

/** Below this zoom node details hide; below the next one connectors draw as plain lines. */
const DETAILS_MIN_ZOOM = 0.45;
const DETAILED_EDGES_MIN_ZOOM = 0.28;

/**
 * Owns the React Flow instance and everything about where the canvas looks: zoom commands,
 * fitting, revealing nodes, and following a viewport that arrives with the graph.
 */
export function useNoteGraphViewport({
  graph,
  getGraph,
  pane,
  readOnly,
  persistViewport,
  revealNodeRequest,
}: {
  graph: NoteGraph;
  getGraph: () => NoteGraph;
  pane: RefObject<HTMLElement | null>;
  readOnly: boolean;
  persistViewport: (viewport: Viewport) => void;
  /** A link in the note asks the canvas to show one node; each request id is handled once. */
  revealNodeRequest?: { nodeId: string; requestId: number } | null;
}) {
  const prefersReducedMotion = useReducedMotion() ?? false;
  const duration = prefersReducedMotion ? 0 : 220;
  const [instance, setInstance] = useState<Instance | null>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const frameRef = useRef(0);
  useEffect(() => () => window.cancelAnimationFrame(frameRef.current), []);

  /** Runs `callback` once the next frame has drawn; a newer request replaces a pending one. */
  const afterNextFrame = useCallback((callback: () => void) => {
    window.cancelAnimationFrame(frameRef.current);
    frameRef.current = window.requestAnimationFrame(callback);
  }, []);

  // A canvas in a tab that was hidden mounts before it has a size, so React Flow measures no
  // node. Once the instance is ready, measure again and fit the view.
  useEffect(() => {
    if (!instance || instance.getNodes().some(isMeasured)) return;
    const frame = window.requestAnimationFrame(() => {
      const nodeIds = getGraph().nodes.map((node) => node.id);
      if (nodeIds.length > 0) updateNodeInternals(nodeIds);
      void instance.fitView({ ...noteGraphFitViewOptions, duration: 0 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [getGraph, instance, updateNodeInternals]);
  const [zoom, setZoom] = useState(() => graph.viewport?.zoom ?? defaultViewport.zoom);
  useOnViewportChange({ onChange: (viewport) => setZoom(viewport.zoom) });

  const keepViewport = useCallback(
    (viewport: Viewport) => {
      if (!readOnly) persistViewport(viewport);
    },
    [persistViewport, readOnly],
  );

  const fitView = useCallback(
    (animationMs = 0) => {
      if (!instance) return;
      const paneSize = measurePane(pane.current);
      const next = paneSize ? fitNoteGraphViewport(getGraph().nodes, paneSize) : null;
      if (!next) {
        void instance.fitView({ ...noteGraphFitViewOptions, duration: animationMs });
        return;
      }
      void instance.setViewport(next, { duration: animationMs });
      keepViewport(next);
    },
    [getGraph, instance, keepViewport, pane],
  );

  /** Fits the view once the next frame has drawn a changed layout. */
  const fitViewSoon = useCallback(
    () => afterNextFrame(() => fitView(duration)),
    [afterNextFrame, duration, fitView],
  );

  const showNodes = useCallback(
    (nodeIds: readonly string[], padding: number) => {
      if (!instance || nodeIds.length === 0) return;
      void instance.fitView({
        nodes: nodeIds.map((id) => ({ id })),
        padding,
        duration,
        maxZoom: noteGraphFitViewOptions.maxZoom,
      });
    },
    [duration, instance],
  );

  const revealNode = useCallback((nodeId: string) => showNodes([nodeId], 0.9), [showNodes]);

  /** Frames newly inserted nodes once they have rendered. */
  const revealNewNodes = useCallback(
    (nodeIds: readonly string[]) => afterNextFrame(() => showNodes(nodeIds, 0.3)),
    [afterNextFrame, showNodes],
  );

  const zoomToNodes = useCallback(
    (nodes: readonly NoteGraphNode[]) => {
      if (!instance || nodes.length === 0) return;
      void instance.fitBounds(getNoteGraphBounds([...nodes], 0), { padding: 0.35, duration });
    },
    [duration, instance],
  );

  const zoomDuration = prefersReducedMotion ? 0 : 160;
  const zoomTo100 = useCallback(
    () => void instance?.zoomTo(1, { duration: zoomDuration }),
    [instance, zoomDuration],
  );
  const zoomIn = useCallback(
    () => void instance?.zoomIn({ duration: zoomDuration }),
    [instance, zoomDuration],
  );
  const zoomOut = useCallback(
    () => void instance?.zoomOut({ duration: zoomDuration }),
    [instance, zoomDuration],
  );

  /** The MiniMap reports the clicked point in flow coordinates. */
  const centerOn = useCallback(
    (_event: React.MouseEvent, position: Point) => {
      if (!instance) return;
      void instance.setCenter(position.x, position.y, {
        zoom: instance.getViewport().zoom,
        duration: zoomDuration,
      });
    },
    [instance, zoomDuration],
  );

  const screenToFlow = useCallback(
    (point: Point, options?: { snapToGrid: boolean }) =>
      instance?.screenToFlowPosition(point, options) ?? null,
    [instance],
  );

  /** The flow point at the centre of the canvas. */
  const centerPoint = useCallback((): Point => {
    const bounds = pane.current?.getBoundingClientRect();
    return (
      screenToFlow({
        x: (bounds?.left ?? 0) + (bounds?.width ?? 600) / 2,
        y: (bounds?.top ?? 0) + (bounds?.height ?? 500) / 2,
      }) ?? { x: 120, y: 120 }
    );
  }, [pane, screenToFlow]);

  const handledRevealIdRef = useRef<number | null>(null);
  const revealRequestPending =
    Boolean(revealNodeRequest) && graph.nodes.some((node) => node.id === revealNodeRequest?.nodeId);
  useEffect(() => {
    if (!revealNodeRequest || !instance || !revealRequestPending) return;
    if (handledRevealIdRef.current === revealNodeRequest.requestId) return;
    handledRevealIdRef.current = revealNodeRequest.requestId;
    const frame = window.requestAnimationFrame(() => revealNode(revealNodeRequest.nodeId));
    return () => window.cancelAnimationFrame(frame);
  }, [instance, revealNode, revealNodeRequest, revealRequestPending]);

  // A viewport that arrives with the graph (undo, another window) moves the canvas. Depend on
  // coordinates, not object identity, so re-publishing never rewinds a pan in progress.
  const { x, y, zoom: viewportZoom } = graph.viewport ?? {};
  useEffect(() => {
    if (!instance || x === undefined || y === undefined || viewportZoom === undefined) return;
    const next = { x, y, zoom: viewportZoom };
    if (areNoteGraphViewportsNearlyEqual(instance.getViewport(), next)) return;
    void instance.setViewport(next, { duration });
  }, [duration, instance, viewportZoom, x, y]);

  return {
    instance,
    onInit: setInstance,
    zoomPct: Math.round(zoom * 100),
    detailsVisible: zoom >= DETAILS_MIN_ZOOM,
    simplifiedEdges: zoom < DETAILED_EDGES_MIN_ZOOM,
    fitView,
    fitViewSoon,
    revealNode,
    revealNewNodes,
    zoomToNodes,
    zoomTo100,
    zoomIn,
    zoomOut,
    centerOn,
    screenToFlow,
    centerPoint,
  };
}

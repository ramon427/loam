import { useCallback, useMemo, useRef, useState } from "react";

import { getNoteGraphNodeCenter } from "./noteGraphGeometry";
import type { NoteGraphImportFormat } from "./noteGraphImport";
import { idleMode, type NoteGraphMode } from "./noteGraphMode";
import { connectNodes, selectedNodes, updateEdge, type NoteGraphSelection } from "./noteGraphOps";
import { buildNoteGraphWalkthroughOrder } from "./noteGraphQuery";
import type { RunNoteGraphOperation } from "./useNoteGraphEdits";
import type { NoteGraph, NoteGraphEdge, NoteGraphNode } from "@loam/shared/notes/noteModel";
import { clamp } from "../lib/clamp";

/** Other nodes ordered by distance from `sourceId`: keyboard connecting cycles through them. */
const connectTargets = (nodes: readonly NoteGraphNode[], sourceId: string) => {
  const source = nodes.find((node) => node.id === sourceId);
  if (!source) return [];
  const from = getNoteGraphNodeCenter(source);
  return nodes
    .filter((node) => node.id !== sourceId)
    .map((node) => {
      const to = getNoteGraphNodeCenter(node);
      return { id: node.id, distance: Math.hypot(to.x - from.x, to.y - from.y) };
    })
    .sort((a, b) => a.distance - b.distance)
    .map((target) => target.id);
};

/**
 * Owns the canvas mode (see {@link NoteGraphMode}) and the commands that enter, step through
 * and leave each mode.
 */
export function useNoteGraphMode({
  graph,
  readOnly,
  run,
  getGraph,
  getSelection,
  selectNode,
  revealNode,
  announce,
}: {
  graph: NoteGraph;
  readOnly: boolean;
  run: RunNoteGraphOperation;
  getGraph: () => NoteGraph;
  getSelection: () => NoteGraphSelection;
  selectNode: (nodeId: string) => void;
  revealNode: (nodeId: string) => void;
  announce: (message: string) => void;
}) {
  const [mode, setMode] = useState<NoteGraphMode>(idleMode);
  const titleEditCountRef = useRef(0);

  const endMode = useCallback(
    (kind: NoteGraphMode["kind"]) =>
      setMode((current) => (current.kind === kind ? idleMode : current)),
    [],
  );

  const beginTitleEdit = useCallback(
    (nodeId: string) => {
      if (readOnly) return;
      titleEditCountRef.current += 1;
      setMode({ kind: "editTitle", nodeId, requestId: titleEditCountRef.current });
    },
    [readOnly],
  );

  const endTitleEdit = useCallback(
    (nodeId: string) =>
      setMode((current) =>
        current.kind === "editTitle" && current.nodeId === nodeId ? idleMode : current,
      ),
    [],
  );

  const showWalkthroughStep = useCallback(
    (order: readonly string[], index: number) => {
      setMode({ kind: "walkthrough", order, index });
      const nodeId = order[index];
      if (!nodeId) return;
      revealNode(nodeId);
      selectNode(nodeId);
    },
    [revealNode, selectNode],
  );

  const startWalkthrough = useCallback(() => {
    const { nodes, edges } = getGraph();
    const order = buildNoteGraphWalkthroughOrder(nodes, edges);
    if (order.length === 0) return;
    showWalkthroughStep(order, 0);
    announce(`Walkthrough: 1 of ${order.length}. Arrow keys move, Escape exits.`);
  }, [announce, getGraph, showWalkthroughStep]);

  const stepWalkthrough = useCallback(
    (delta: 1 | -1) => {
      if (mode.kind !== "walkthrough") return;
      const index = clamp(mode.index + delta, 0, mode.order.length - 1);
      showWalkthroughStep(mode.order, index);
    },
    [mode, showWalkthroughStep],
  );

  const connectTargetIds = useMemo(
    () => (mode.kind === "connect" ? connectTargets(graph.nodes, mode.sourceId) : []),
    [graph.nodes, mode],
  );
  const connectTargetId =
    mode.kind === "connect" && connectTargetIds.length > 0
      ? connectTargetIds[
          ((mode.candidateIndex % connectTargetIds.length) + connectTargetIds.length) %
            connectTargetIds.length
        ]!
      : null;

  const startConnect = useCallback(() => {
    if (readOnly) return;
    const picked = selectedNodes({ graph: getGraph(), selection: getSelection() });
    if (picked.length !== 1) {
      announce("Select exactly one node to connect from");
      return;
    }
    if (getGraph().nodes.length < 2) return;
    setMode({ kind: "connect", sourceId: picked[0]!.id, candidateIndex: 0 });
    announce("Choose a target with the arrow keys, Enter connects, Escape cancels");
  }, [announce, getGraph, getSelection, readOnly]);

  const moveConnectTarget = useCallback(
    (delta: 1 | -1) =>
      setMode((current) =>
        current.kind === "connect"
          ? { ...current, candidateIndex: current.candidateIndex + delta }
          : current,
      ),
    [],
  );

  const commitConnect = useCallback(() => {
    if (mode.kind !== "connect" || !connectTargetId) return;
    if (run((state) => connectNodes(state, mode.sourceId, connectTargetId))?.graph) {
      setMode(idleMode);
    }
  }, [connectTargetId, mode, run]);

  const editEdgeLabel = useCallback(
    (edgeId: string) => {
      const edge = getGraph().edges.find((candidate) => candidate.id === edgeId);
      setMode({ kind: "editEdgeLabel", edgeId, draft: edge?.label ?? "" });
    },
    [getGraph],
  );

  const setEdgeLabelDraft = useCallback(
    (draft: string) =>
      setMode((current) => (current.kind === "editEdgeLabel" ? { ...current, draft } : current)),
    [],
  );

  const commitEdgeLabel = useCallback(() => {
    if (mode.kind !== "editEdgeLabel") return;
    const label: NoteGraphEdge["label"] = mode.draft.trim() || undefined;
    run((state) => updateEdge(state, mode.edgeId, { label }));
    setMode(idleMode);
  }, [mode, run]);

  return {
    mode,
    endMode,
    beginTitleEdit,
    endTitleEdit,
    startWalkthrough,
    stepWalkthrough,
    startConnect,
    moveConnectTarget,
    commitConnect,
    connectTargetId,
    editEdgeLabel,
    setEdgeLabelDraft,
    commitEdgeLabel,
    openImport: useCallback(
      (format: NoteGraphImportFormat) => setMode({ kind: "import", format }),
      [],
    ),
    openHeadingManager: useCallback(
      (nodeId: string) => setMode({ kind: "headingManager", nodeId }),
      [],
    ),
    toggleSnapshotCapture: useCallback(
      () =>
        setMode((current) =>
          current.kind === "captureSnapshot" ? idleMode : { kind: "captureSnapshot" },
        ),
      [],
    ),
    startTouchMarquee: useCallback(() => setMode({ kind: "touchMarquee" }), []),
  };
}

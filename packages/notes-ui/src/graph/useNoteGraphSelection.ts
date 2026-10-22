import { useCallback, useLayoutEffect, useRef } from "react";

import type { NoteGraphSelection } from "./noteGraphOps";
import { useValueStore } from "./useValueStore";

/**
 * Owns the canvas selection. The note only tracks one primary node or connector, so this
 * reports the primary to it and adopts a primary the note sets on its own (for example a
 * link that reveals a node). React Flow's `selected` flags are derived from this state.
 */
export function useNoteGraphSelection({
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
}: {
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
}) {
  const [selection, store] = useValueStore<NoteGraphSelection>(() => ({
    nodeIds: selectedNodeId ? [selectedNodeId] : [],
    edgeId: selectedNodeId ? null : selectedEdgeId,
  }));
  // What the note last heard from us or told us, so its echoes are not mistaken for changes.
  const reportedRef = useRef({ nodeId: selectedNodeId, edgeId: selectedEdgeId });

  const select = useCallback(
    (next: NoteGraphSelection) => {
      store.set(next);
      const nodeId = next.nodeIds[0] ?? null;
      const edgeId = nodeId ? null : next.edgeId;
      const reported = reportedRef.current;
      reportedRef.current = { nodeId, edgeId };
      if (nodeId !== reported.nodeId) onSelectNode(nodeId);
      if (edgeId !== reported.edgeId) onSelectEdge(edgeId);
    },
    [onSelectEdge, onSelectNode, store],
  );

  useLayoutEffect(() => {
    const reported = reportedRef.current;
    if (selectedNodeId === reported.nodeId && selectedEdgeId === reported.edgeId) return;
    reportedRef.current = { nodeId: selectedNodeId, edgeId: selectedEdgeId };
    store.set({
      nodeIds: selectedNodeId ? [selectedNodeId] : [],
      edgeId: selectedNodeId ? null : selectedEdgeId,
    });
  }, [selectedEdgeId, selectedNodeId, store]);

  return { selection, getSelection: store.get, select };
}

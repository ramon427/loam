import { useCallback, useMemo } from "react";

import type { NoteGraph } from "@loam/shared/notes/noteModel";

import { findNoteGraphFrameMemberIds } from "./noteGraphFrames";
import type { NoteGraphMode } from "./noteGraphMode";
import type { NoteGraphNodeActions } from "./noteGraphNodeActions";
import * as ops from "./noteGraphOps";
import type { RunNoteGraphOperation } from "./useNoteGraphEdits";
import type { NoteGraphNodeCommands } from "./useNoteGraphNodeCommands";

/** What every node card on the canvas can do, given to the cards through context. */
export function useNoteGraphNodeActions({
  graph,
  readOnly,
  detailsVisible,
  run,
  updateNode,
  clearTransientNode,
  mode,
  beginTitleEdit,
  endTitleEdit,
  openHeadingManager,
  selectNode,
  requestImageUpload,
  seekVideoTimestamp,
  focusPane,
  openDetails,
}: {
  graph: NoteGraph;
  readOnly: boolean;
  detailsVisible: boolean;
  run: RunNoteGraphOperation;
  updateNode: NoteGraphNodeCommands["updateNode"];
  /** Drops a node's drag or resize preview once its change is saved. */
  clearTransientNode: (nodeId: string) => void;
  mode: NoteGraphMode;
  beginTitleEdit: (nodeId: string) => void;
  endTitleEdit: (nodeId: string) => void;
  openHeadingManager: (nodeId: string) => void;
  selectNode: (nodeId: string | null) => void;
  requestImageUpload: (nodeId: string) => void;
  seekVideoTimestamp?: (seconds: number) => void;
  focusPane: () => void;
  openDetails: (nodeId?: string) => void;
}): NoteGraphNodeActions {
  const frameMemberCount = useCallback(
    (frameId: string) => {
      const frame = graph.nodes.find((node) => node.id === frameId);
      return frame ? findNoteGraphFrameMemberIds(graph.nodes, frame).length : 0;
    },
    [graph.nodes],
  );
  const openHeadingConnections = useCallback(
    (nodeId: string) => {
      openHeadingManager(nodeId);
      selectNode(nodeId);
    },
    [openHeadingManager, selectNode],
  );
  return useMemo<NoteGraphNodeActions>(
    () => ({
      readOnly,
      detailsVisible,
      updateNode,
      resizeNode: (nodeId, rect) => {
        run((state) => ops.resizeNode(state, nodeId, rect));
        clearTransientNode(nodeId);
      },
      chainFromNode: (nodeId, kind, patch) => {
        const edit = run((state) => ops.chainNode(state, { sourceId: nodeId, kind, patch }));
        const added = edit?.addedNodeIds?.[0];
        if (added) beginTitleEdit(added);
      },
      toggleFrameCollapsed: (frameId) => run((state) => ops.toggleFrameCollapsed(state, frameId)),
      removeEmptyText: (nodeId) => run((state) => ops.removeEmptyText(state, nodeId)),
      frameMemberCount,
      openHeadingConnections,
      requestImageUpload,
      seekVideoTimestamp,
      focusGraphPane: focusPane,
      titleEdit: mode.kind === "editTitle" ? mode : null,
      beginTitleEdit,
      endTitleEdit,
      openDetails,
    }),
    [
      clearTransientNode,
      focusPane,
      frameMemberCount,
      requestImageUpload,
      mode,
      beginTitleEdit,
      endTitleEdit,
      openHeadingConnections,
      openDetails,
      seekVideoTimestamp,
      readOnly,
      run,
      updateNode,
      detailsVisible,
    ],
  );
}

import type { NoteGraphKeyCommands } from "./noteGraphKeymap";
import * as ops from "./noteGraphOps";
import type { RunNoteGraphOperation } from "./useNoteGraphEdits";
import type { NoteGraphNodeCommands } from "./useNoteGraphNodeCommands";
import type { useNoteGraphDocument } from "./useNoteGraphDocument";
import type { useNoteGraphMode } from "./useNoteGraphMode";
import type { useNoteGraphSearch } from "./useNoteGraphSearch";
import type { useNoteGraphViewport } from "./useNoteGraphViewport";

/** What the graph's keys do, in terms of the canvas's parts. */
export const createNoteGraphKeyCommands = ({
  run,
  getState,
  getSelection,
  select,
  focusPane,
  toggleFocusMode,
  nodes,
  modes,
  search,
  viewport,
  history,
}: {
  run: RunNoteGraphOperation;
  getState: () => ops.NoteGraphState;
  getSelection: () => ops.NoteGraphSelection;
  select: (selection: ops.NoteGraphSelection) => void;
  focusPane: () => void;
  toggleFocusMode: () => void;
  nodes: NoteGraphNodeCommands;
  modes: ReturnType<typeof useNoteGraphMode>;
  search: ReturnType<typeof useNoteGraphSearch>;
  viewport: ReturnType<typeof useNoteGraphViewport>;
  history: ReturnType<typeof useNoteGraphDocument>["history"];
}): NoteGraphKeyCommands => ({
  focusPane,
  closeSnapshotCapture: () => modes.endMode("captureSnapshot"),
  exitTouchMarquee: () => modes.endMode("touchMarquee"),
  exitWalkthrough: () => modes.endMode("walkthrough"),
  stepWalkthrough: modes.stepWalkthrough,
  cancelConnect: () => modes.endMode("connect"),
  commitConnect: modes.commitConnect,
  moveConnectTarget: modes.moveConnectTarget,
  openSearch: search.openSearch,
  addNodeInCenter: () => nodes.addNodeAndEditTitle(viewport.centerPoint()),
  zoomTo100: viewport.zoomTo100,
  zoomToSelection: () => viewport.zoomToNodes(ops.selectedNodes(getState())),
  zoomIn: viewport.zoomIn,
  zoomOut: viewport.zoomOut,
  fitView: () => viewport.fitView(),
  startConnect: modes.startConnect,
  toggleFocusMode,
  copy: nodes.copySelection,
  cut: () => {
    if (nodes.copySelection()) run(ops.deleteSelection);
  },
  duplicate: () => run(ops.duplicateSelection),
  selectAll: () => run(ops.selectAll),
  undo: history.undo,
  redo: history.redo,
  deleteSelection: () => run(ops.deleteSelection),
  clearSelection: () => select(ops.emptyNoteGraphSelection),
  renameSelection: () => {
    const primary = getSelection().nodeIds[0];
    if (primary) modes.beginTitleEdit(primary);
    else focusPane();
  },
  // Arrow-key bursts share one undo step.
  nudge: (delta) => run((state) => ops.nudgeSelection(state, delta), "nudge"),
  resize: (direction, step) =>
    run((state) => ops.resizeSelectionWithKeyboard(state, direction, step)),
});

import { useCallback, useRef } from "react";

import type { NoteGraphNode, NoteGraphNodeShape } from "@loam/shared/notes/noteModel";
import { formatVideoTimestamp } from "@loam/shared/notes/noteVideo";

import * as ops from "./noteGraphOps";
import type { RunNoteGraphOperation } from "./useNoteGraphEdits";

type Point = { x: number; y: number };

/**
 * Adding nodes, copying and pasting them, and laying them out. Layout changes
 * are followed by fitting the view to the result.
 */
export function useNoteGraphNodeCommands({
  run,
  getState,
  centerPoint,
  fitViewSoon,
  beginTitleEdit,
  announce,
  getVideoSeconds,
}: {
  run: RunNoteGraphOperation;
  getState: () => ops.NoteGraphState;
  /** The flow position at the centre of the canvas. */
  centerPoint: () => Point;
  fitViewSoon: () => void;
  beginTitleEdit: (nodeId: string) => void;
  announce: (message: string) => void;
  /** Where the note's video is, when the note has one. */
  getVideoSeconds?: () => number | null;
}) {
  const clipboardRef = useRef<ops.NoteGraphClipboard | null>(null);

  const addNodeAt = useCallback(
    (shape: NoteGraphNodeShape, position: Point, patch?: Partial<NoteGraphNode>) =>
      run((state) => ops.addNode(state, { shape, position, patch }))?.addedNodeIds?.[0] ?? null,
    [run],
  );
  /** Adds a node with its top-left corner at the centre of the canvas. */
  const addNodeInCenter = useCallback(
    (shape: NoteGraphNodeShape, patch?: Partial<NoteGraphNode>) =>
      addNodeAt(shape, centerPoint(), patch),
    [addNodeAt, centerPoint],
  );
  const addNodeAndEditTitle = useCallback(
    (position: Point) => {
      const nodeId = addNodeAt("process", position);
      if (!nodeId) return;
      beginTitleEdit(nodeId);
      announce("Node added");
    },
    [addNodeAt, announce, beginTitleEdit],
  );
  const addVideoTimeNode = useCallback(() => {
    const seconds = getVideoSeconds?.();
    if (seconds === null || seconds === undefined) return;
    const label = formatVideoTimestamp(seconds);
    const nodeId = addNodeInCenter("process", {
      timestampSeconds: Math.floor(seconds),
      title: label,
    });
    if (!nodeId) return;
    beginTitleEdit(nodeId);
    announce(`Node at ${label}`);
  }, [addNodeInCenter, announce, beginTitleEdit, getVideoSeconds]);
  const updateNode = useCallback(
    (nodeId: string, patch: Partial<NoteGraphNode>, historyGroup?: string) =>
      run((state) => ops.updateNode(state, nodeId, patch), historyGroup),
    [run],
  );

  const copySelection = useCallback(() => {
    const clipboard = ops.copySelection(getState());
    if (clipboard) clipboardRef.current = clipboard;
    return Boolean(clipboard);
  }, [getState]);
  const pasteAt = useCallback(
    (at: Point | null) => {
      const clipboard = clipboardRef.current;
      return Boolean(clipboard && run((state) => ops.pasteClipboard(state, clipboard, at))?.graph);
    },
    [run],
  );
  const canPaste = useCallback(() => Boolean(clipboardRef.current), []);

  const runLayout = useCallback(
    (operation: (state: ops.NoteGraphState) => ops.NoteGraphEdit | null) => {
      if (run(operation)?.graph) fitViewSoon();
    },
    [fitViewSoon, run],
  );

  return {
    addNodeAt,
    addNodeInCenter,
    addNodeAndEditTitle,
    addVideoTimeNode,
    updateNode,
    copySelection,
    pasteAt,
    canPaste,
    runLayout,
  };
}

export type NoteGraphNodeCommands = ReturnType<typeof useNoteGraphNodeCommands>;

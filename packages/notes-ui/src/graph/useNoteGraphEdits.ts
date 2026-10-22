import { useCallback, useEffect, useRef, useState } from "react";

import { useReducedMotion } from "framer-motion";

import type { NoteGraphEdit, NoteGraphSelection, NoteGraphState } from "./noteGraphOps";
import type { NoteGraph } from "@loam/shared/notes/noteModel";

const STATUS_CLEAR_MS = 4000;
const NEW_NODE_HIGHLIGHT_MS = 700;

export type RunNoteGraphOperation = (
  operation: (state: NoteGraphState) => NoteGraphEdit | null,
  historyGroup?: string,
) => NoteGraphEdit | null;

/**
 * Applies graph operations: commits the new graph as one undo step, updates the selection,
 * briefly highlights new nodes and shows the operation's message in the status line.
 */
export function useNoteGraphEdits({
  readOnly,
  getGraph,
  commit,
  getSelection,
  select,
}: {
  readOnly: boolean;
  getGraph: () => NoteGraph;
  commit: (graph: NoteGraph, historyGroup?: string) => void;
  getSelection: () => NoteGraphSelection;
  select: (selection: NoteGraphSelection) => void;
}) {
  const prefersReducedMotion = useReducedMotion() ?? false;
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [newNodeIds, setNewNodeIds] = useState<ReadonlySet<string>>(() => new Set());
  const statusTimerRef = useRef<number | undefined>(undefined);
  const highlightTimerRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(statusTimerRef.current);
      window.clearTimeout(highlightTimerRef.current);
    },
    [],
  );

  const announce = useCallback((message: string) => {
    setStatusMessage(message);
    window.clearTimeout(statusTimerRef.current);
    statusTimerRef.current = window.setTimeout(() => setStatusMessage(null), STATUS_CLEAR_MS);
  }, []);

  const highlightNewNodes = useCallback(
    (ids: readonly string[]) => {
      if (prefersReducedMotion || ids.length === 0) return;
      setNewNodeIds(new Set(ids));
      window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = window.setTimeout(
        () => setNewNodeIds(new Set()),
        NEW_NODE_HIGHLIGHT_MS,
      );
    },
    [prefersReducedMotion],
  );

  const getState = useCallback(
    (): NoteGraphState => ({ graph: getGraph(), selection: getSelection() }),
    [getGraph, getSelection],
  );

  /** Read-only canvases accept selection changes only. */
  const run = useCallback<RunNoteGraphOperation>(
    (operation, historyGroup) => {
      const edit = operation(getState());
      if (!edit || (edit.graph && readOnly)) return null;
      if (edit.graph) commit(edit.graph, historyGroup);
      if (edit.selection) select(edit.selection);
      if (edit.addedNodeIds) highlightNewNodes(edit.addedNodeIds);
      if (edit.announce) announce(edit.announce);
      return edit;
    },
    [announce, commit, getState, highlightNewNodes, readOnly, select],
  );

  return { run, getState, announce, statusMessage, newNodeIds };
}

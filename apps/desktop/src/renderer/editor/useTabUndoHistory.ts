import { useEffect, useLayoutEffect } from "react";

import {
  captureEditorUndoCheckpoint,
  restoreEditorUndoCheckpoint,
  type EditorUndoCheckpoint,
} from "./editorUndoCheckpoint";
import type { NoteBlockEditor } from "./noteEditorSchema";

import type { NoteHeadingConnectionSnapshot } from "./noteHeadingConnections";
import type { HeadingTombstones } from "./useHeadingDeletionGuard";

type KeptHistory = {
  checkpoint: EditorUndoCheckpoint;
  tombstones: Array<[string, NoteHeadingConnectionSnapshot[]]>;
  keepUntil: number;
};

const MAX_KEPT = 24;
const KEEP_MS = 30 * 60_000;

/** Undo histories of page tabs out of view, by note and tab, oldest first. */
const kept = new Map<string, KeptHistory>();

const keep = (key: string, history: KeptHistory) => {
  kept.delete(key);
  kept.set(key, history);
  for (const oldest of kept.keys()) {
    if (kept.size <= MAX_KEPT) break;
    kept.delete(oldest);
  }
};

const take = (key: string) => {
  const history = kept.get(key);
  kept.delete(key);
  return history && history.keepUntil > Date.now() ? history : null;
};

/**
 * Keeps a page tab's undo history while the tab is out of view, for half an
 * hour: saved as its editor goes away, given back when an editor for the same
 * tab shows the same text again. The heading links that undo would restore
 * go with it.
 */
export function useTabUndoHistory(
  editor: NoteBlockEditor,
  key: string,
  tombstones: HeadingTombstones,
) {
  useEffect(() => {
    const history = take(key);
    const view = editor.prosemirrorView;
    if (!history || !view) return;
    const restored = restoreEditorUndoCheckpoint(view.state, history.checkpoint);
    if (!restored) return;
    view.updateState(restored);
    for (const [headingId, snapshots] of history.tombstones) tombstones.set(headingId, snapshots);
  }, [editor, key, tombstones]);

  // A layout cleanup runs before BlockNote tears the view down, so the state is still there.
  useLayoutEffect(
    () => () => {
      const checkpoint = captureEditorUndoCheckpoint(editor.prosemirrorState);
      if (!checkpoint || checkpoint.undo.length + checkpoint.redo.length === 0) return;
      keep(key, { checkpoint, tombstones: [...tombstones], keepUntil: Date.now() + KEEP_MS });
    },
    [editor, key, tombstones],
  );
}

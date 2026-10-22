import { useCallback, useState, type MutableRefObject } from "react";

import { useTypedTabHistory, type TabHistoryCommands } from "../note/useTypedTabHistory";
import type { NoteTable } from "@loam/shared/notes/noteModel";

import { positionNoteTable } from "./tableCommands";

/**
 * The table a table tab shows, and how edits reach the note. Every edit is committed at
 * once through the tab's undo history; edits that share a `group` key and follow each other
 * quickly (typing a column name) undo as one step. The note's own saves are debounced, so
 * nothing here waits or needs flushing.
 */
export function useTableDraft({
  tabId,
  table,
  onUpdateTable,
  historyBridgeRef,
}: {
  tabId: string;
  table: NoteTable;
  onUpdateTable: (table: NoteTable) => void;
  historyBridgeRef?: MutableRefObject<TabHistoryCommands | null>;
}) {
  // The last table published or received. Undo can publish the very table object the
  // parent already holds, which would not re-render from props alone.
  const [shown, setShown] = useState({ received: table, table });
  if (shown.received !== table) setShown({ received: table, table });

  const publish = useCallback(
    (next: NoteTable) => {
      setShown((current) => ({ ...current, table: next }));
      onUpdateTable(next);
    },
    [onUpdateTable],
  );
  const history = useTypedTabHistory({
    identity: tabId,
    value: table,
    onCommit: publish,
    bridgeRef: historyBridgeRef,
  });
  const { commit: commitToHistory } = history;
  const commit = useCallback(
    (next: NoteTable | null, group?: string) => {
      if (next) commitToHistory(positionNoteTable(next), group);
    },
    [commitToHistory],
  );

  return { table: shown.table, commit };
}

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { NoteConflict, NotesChange } from "@loam/shared/notes/noteModel";
import { callBridge, onBridgeEvent } from "../host/notesHost";
import { toastInfo } from "../ui/toast";

import { noteRead, onNoteSaved, readNoteSaveStatus } from "./noteSaves";
import { dropNoteQuery, LIBRARY_KEY, noteKey } from "./notesLibrary";
import type { NotesWorkspace } from "./NotesWorkspace";
import type { NoteDocument } from "./types";

/**
 * Keeps the window up to date with changes made elsewhere: by sync, by
 * another of its own saves, or by a restored version.
 */
export function useSyncedChanges({
  activeNoteId,
  openHistory,
  leaveDeletedNotes,
  recover,
}: {
  activeNoteId: string | null;
  openHistory: NotesWorkspace["openHistory"];
  leaveDeletedNotes: (deletedIds: ReadonlySet<string>) => void;
  recover: (message: string, error: unknown) => void;
}) {
  const queryClient = useQueryClient();
  const [activeNoteRevision, setActiveNoteRevision] = useState(0);

  const announceConflicts = useCallback(
    (conflicts: readonly NoteConflict[]) => {
      for (const { noteId, versionId, title } of conflicts)
        toastInfo("Edited in two places at once", {
          description: `The other edit to “${title || "Untitled"}” is in its version history.`,
          action: {
            label: "Compare",
            onClick: () => openHistory({ noteId, title, versionId }),
          },
        });
    },
    [openHistory],
  );

  // Links change when a note is saved, so what links where is read again.
  useEffect(
    () =>
      onNoteSaved((_noteId, conflict) => {
        void queryClient.invalidateQueries({ queryKey: ["note-backlinks"] });
        if (!conflict) return;
        void queryClient.invalidateQueries({ queryKey: ["note-history", conflict.noteId] });
        announceConflicts([conflict]);
      }),
    [announceConflicts, queryClient],
  );

  /**
   * Catches up with changes sync brought. Notes with unsaved edits keep them:
   * their next save keeps the synced version in its history, and one
   * deleted elsewhere is put back, since an edit beats a delete.
   */
  const applySyncedChanges = useCallback(
    (changes: NotesChange) => {
      const unsaved = (noteId: string) => readNoteSaveStatus(noteId) !== "saved";
      for (const noteId of changes.changedNoteIds) {
        if (unsaved(noteId)) continue;
        // A live snapshot can be observing this source while another note is open.
        if (
          noteId !== activeNoteId &&
          !queryClient
            .getQueryCache()
            .find({ queryKey: noteKey(noteId) })
            ?.isActive()
        ) {
          queryClient.removeQueries({ queryKey: noteKey(noteId) });
          continue;
        }
        void callBridge("notes.get", { noteId })
          .then((note) => {
            // Typing started meanwhile: keep the edits; their save keeps this version.
            if (unsaved(noteId)) return;
            noteRead(note as NoteDocument);
            queryClient.setQueryData(noteKey(noteId), note);
            if (noteId === activeNoteId) setActiveNoteRevision((revision) => revision + 1);
          })
          .catch(() => undefined);
      }
      const gone = new Set<string>();
      for (const noteId of changes.deletedNoteIds) {
        const edited = queryClient.getQueryData<NoteDocument>(noteKey(noteId));
        if (unsaved(noteId) && edited?.contentState === "full") {
          void callBridge("notes.restore", { note: edited }).catch((error: unknown) =>
            recover("Note not kept", error),
          );
          continue;
        }
        gone.add(noteId);
        dropNoteQuery(queryClient, noteId);
      }
      leaveDeletedNotes(gone);
      void queryClient.invalidateQueries({ queryKey: LIBRARY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["note-backlinks"] });
      void queryClient.invalidateQueries({ queryKey: ["notes-trash"] });
      for (const { noteId } of changes.conflicts)
        void queryClient.invalidateQueries({ queryKey: ["note-history", noteId] });
      announceConflicts(changes.conflicts);
    },
    [activeNoteId, announceConflicts, leaveDeletedNotes, queryClient, recover],
  );

  useEffect(() => onBridgeEvent("notes.changed", applySyncedChanges), [applySyncedChanges]);

  const reloadNote = useCallback(
    (noteId: string) =>
      applySyncedChanges({
        changedNoteIds: [noteId],
        deletedNoteIds: [],
        layoutChanged: false,
        conflicts: [],
      }),
    [applySyncedChanges],
  );

  return { activeNoteRevision, reloadNote };
}

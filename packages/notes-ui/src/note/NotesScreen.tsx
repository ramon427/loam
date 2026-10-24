import { useCallback, useMemo } from "react";

import { BridgeError } from "../host/notesHost";
import { toastError } from "../ui/toast";
import { useShortcuts, type Shortcut } from "../keyboard/useShortcuts";
import { PageReadError } from "../ui/PageReadError";

import { NoteDocumentSkeleton } from "./NoteDocumentSkeleton";
import { saveNoteEdits } from "../workspace/noteSaves";
import { useNoteDocument, useNotesWorkspace } from "../workspace/NotesWorkspace";
import { NoteHeaderSkeleton } from "./NoteHeader";
import { NoteLayout } from "./NoteLayout";
import { NoteView } from "./NoteView";
import { NotesOpenEmptyState } from "./NotesOpenEmptyState";
import { errorMessage } from "../lib/errorMessage";

/** The main column: the open note, the note being loaded, or why there is none. */
export function NotesScreen({ onCreateNote }: { onCreateNote?: () => void } = {}) {
  const workspace = useNotesWorkspace();
  const { activeNoteId } = workspace;
  const note = useNoteDocument(activeNoteId);

  // Notes save by themselves after a pause; this saves the open one now.
  const save = useCallback(async () => {
    if (!activeNoteId) return;
    try {
      await saveNoteEdits(activeNoteId);
    } catch (error) {
      toastError("Note not saved", {
        description: errorMessage(error),
      });
    }
  }, [activeNoteId]);

  const shortcuts = useMemo(
    (): Shortcut[] => [
      {
        id: "entry.save",
        enabled: Boolean(activeNoteId),
        allowInEditable: true,
        run: () => void save(),
      },
    ],
    [activeNoteId, save],
  );
  useShortcuts(shortcuts);

  if (workspace.loadError) {
    return (
      <NoteLayout>
        <PageReadError state="unavailable" onRetry={workspace.reloadLibrary} />
      </NoteLayout>
    );
  }
  if (!activeNoteId || note.isError) {
    const missing =
      Boolean(activeNoteId) && note.error instanceof BridgeError && note.error.code === "NOT_FOUND";
    if (activeNoteId && !missing) {
      return (
        <NoteLayout>
          <PageReadError state="unavailable" onRetry={() => void note.refetch()} />
        </NoteLayout>
      );
    }
    return (
      <NoteLayout>
        <div className="w-full pt-12">
          <NotesOpenEmptyState
            missing={missing}
            onCreateNote={onCreateNote ?? (() => void workspace.createNote())}
          />
        </div>
      </NoteLayout>
    );
  }
  if (note.data?.contentState !== "full") {
    return (
      <NoteLayout header={<NoteHeaderSkeleton />}>
        <NoteDocumentSkeleton />
      </NoteLayout>
    );
  }
  return (
    <NoteView key={note.data.id} note={note.data} syncRevision={workspace.activeNoteRevision} />
  );
}

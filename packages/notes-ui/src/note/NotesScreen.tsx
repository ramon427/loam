import { useCallback, useEffect, useMemo, useState } from "react";

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

// A local read usually lands within a frame or two; the skeleton is for one that doesn't.
const SLOW_READ_MS = 300;

/** The main column: the open note, the note being loaded, or why there is none. */
export function NotesScreen({ onCreateNote }: { onCreateNote?: () => void } = {}) {
  const workspace = useNotesWorkspace();
  const { activeNoteId } = workspace;
  const note = useNoteDocument(activeNoteId, { keepShown: true });
  const ready = !note.isPlaceholderData && note.data?.contentState === "full";
  const reading = Boolean(activeNoteId) && !note.isError && !ready;

  // The note switched from stays on screen while the next is read, until the read is slow.
  const [slowNoteId, setSlowNoteId] = useState<string | null>(null);
  useEffect(() => {
    if (!reading) return;
    const timer = setTimeout(() => setSlowNoteId(activeNoteId), SLOW_READ_MS);
    return () => clearTimeout(timer);
  }, [activeNoteId, reading]);
  const slow = reading && slowNoteId === activeNoteId;

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
  const held = reading && !slow && note.data?.contentState === "full" ? note.data : undefined;
  const shown = ready ? note.data : held;
  if (!shown) {
    if (reading && !slow) return <NoteLayout>{null}</NoteLayout>;
    return (
      <NoteLayout header={<NoteHeaderSkeleton />}>
        <NoteDocumentSkeleton />
      </NoteLayout>
    );
  }
  // One wrapper for the open and the held note, so the note switched from isn't mounted again.
  return (
    <div data-note-held={held ? true : undefined} inert={Boolean(held)} className="contents">
      <NoteView key={shown.id} note={shown} syncRevision={workspace.activeNoteRevision} />
    </div>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcwIcon, Trash2Icon } from "lucide-react";

import { callBridge } from "../host/notesHost";
import type { NoteTrashEntry } from "@loam/shared/notes/noteModel";
import { useNotesWorkspace } from "../workspace/NotesWorkspace";
import { noteRead } from "../workspace/noteSaves";
import { toastError, toastSuccess } from "../ui/toast";
import { Button } from "../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/Dialog";
import { DestructiveConfirmDialog } from "../ui/DestructiveConfirmDialog";
import { Notice } from "../ui/Notice";

import { useNotesTreeCommands } from "./useNotesTreeCommands";

const TRASH_KEY = ["notes-trash"] as const;

export function NotesTrashButton({ onRestore }: { onRestore?: () => void } = {}) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<NoteTrashEntry | null>(null);
  const workspace = useNotesWorkspace();
  const { forgetHistory } = useNotesTreeCommands();
  const client = useQueryClient();
  const trash = useQuery({
    queryKey: TRASH_KEY,
    queryFn: () => callBridge("notes.trash", {}),
    enabled: open,
    staleTime: 0,
  });
  const onError = (error: Error) =>
    toastError("Trash could not be updated", { description: error.message });
  const restore = useMutation({
    mutationFn: (noteId: string) => callBridge("notes.restoreTrash", { noteId }),
    onSuccess: async (note) => {
      noteRead(note);
      client.setQueryData(["note", note.id], note);
      await Promise.all([
        client.invalidateQueries({ queryKey: TRASH_KEY }),
        client.invalidateQueries({ queryKey: ["notes-library"] }),
        client.invalidateQueries({ queryKey: ["note-content-search"] }),
        client.invalidateQueries({ queryKey: ["note-backlinks"] }),
      ]);
      onRestore?.();
      workspace.openNote(note.id);
      setOpen(false);
      toastSuccess(`Restored “${note.title || "Untitled"}”`);
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (noteId: string) => callBridge("notes.deleteForever", { noteId }),
    onSuccess: async (_result, noteId) => {
      forgetHistory();
      client.removeQueries({ queryKey: ["note-history", noteId] });
      client.removeQueries({ queryKey: ["note-version", noteId] });
      setDeleting(null);
      await client.invalidateQueries({ queryKey: TRASH_KEY });
    },
    onError,
  });
  const busy = restore.isPending || remove.isPending;

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        aria-label="Trash"
        title="Trash"
      >
        <Trash2Icon className="size-4" aria-hidden="true" />
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Trash</DialogTitle>
            <DialogDescription>
              Deleted notes stay here until you restore or permanently delete them.
            </DialogDescription>
          </DialogHeader>
          {trash.isPending ? <p role="status">Loading deleted notes…</p> : null}
          {trash.isError ? (
            <Notice tone="danger">
              Could not read Trash.{" "}
              <Button variant="ghost" onClick={() => void trash.refetch()}>
                Try again
              </Button>
            </Notice>
          ) : null}
          {trash.data?.length === 0 ? (
            <p className="text-sm text-(--app-muted)">Trash is empty.</p>
          ) : null}
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto" aria-label="Deleted notes">
            {trash.data?.map((note) => (
              <li key={note.id}>
                <div
                  role="group"
                  aria-label={note.title || "Untitled"}
                  className="flex items-center gap-2 rounded-md border border-(--app-border) p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{note.title || "Untitled"}</p>
                    <p className="text-xs text-(--app-muted)">
                      Deleted {new Date(note.deletedAt).toLocaleString()}
                    </p>
                  </div>
                  <Button size="sm" disabled={busy} onClick={() => restore.mutate(note.id)}>
                    <RotateCcwIcon className="size-4" aria-hidden="true" />
                    Restore
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    aria-label={`Permanently delete ${note.title || "Untitled"}`}
                    onClick={() => setDeleting(note)}
                  >
                    <Trash2Icon className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <DestructiveConfirmDialog
            open={deleting !== null}
            onOpenChange={(value) => {
              if (!value) setDeleting(null);
            }}
            title="Permanently delete this note?"
            target={deleting?.title || "Untitled"}
            currentState="Recoverable in Trash"
            nextState="Removed from Trash"
            blastRadius="This note and its version history on this computer are deleted. Earlier backups may still contain it."
            confirmLabel="Delete permanently"
            confirmPending={remove.isPending}
            onConfirm={() => {
              if (deleting) remove.mutate(deleting.id);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

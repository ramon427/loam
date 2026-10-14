import { Trash2Icon } from "lucide-react";
import { useMemo } from "react";

import type { NoteDocument } from "../workspace/types";
import type { NoteFolder } from "@loam/shared/notes/noteModel";
import { Button } from "../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/Dialog";

import { getNoteTitle, type NotesDeleteCandidate } from "./notesTreeModel";
type NotesSidebarDeleteDialogProps = {
  candidate: NotesDeleteCandidate | null;
  notesById: ReadonlyMap<string, NoteDocument>;
  foldersById: ReadonlyMap<string, NoteFolder>;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};
export function NotesSidebarDeleteDialog({
  candidate: deleteCandidate,
  notesById,
  foldersById,
  isDeleting,
  onCancel,
  onConfirm,
}: NotesSidebarDeleteDialogProps) {
  const deleteCandidateCount = deleteCandidate
    ? deleteCandidate.noteIds.length + deleteCandidate.folderIds.length
    : 0;
  const isSingleNoteDelete = deleteCandidateCount === 1 && deleteCandidate?.noteIds.length === 1;
  const isSingleFolderDelete =
    deleteCandidateCount === 1 && deleteCandidate?.folderIds.length === 1;

  let deleteDialogTitle = `Delete ${deleteCandidateCount} items?`;
  let deleteDialogDescription =
    "Selected notes move to Trash, where you can restore them. Selected folders are removed; notes inside them stay in your library.";
  let deleteDialogCancelLabel = "Keep items";
  let deleteDialogConfirmLabel = `Delete ${deleteCandidateCount} items`;
  if (isSingleNoteDelete) {
    deleteDialogTitle = "Delete note?";
    deleteDialogDescription = "This moves the note to Trash. You can restore it anytime.";
    deleteDialogCancelLabel = "Keep note";
    deleteDialogConfirmLabel = "Delete note";
  } else if (isSingleFolderDelete) {
    deleteDialogTitle = "Delete folder?";
    deleteDialogDescription =
      "This removes the folder. Notes inside it stay in your notes library.";
    deleteDialogCancelLabel = "Keep folder";
    deleteDialogConfirmLabel = "Delete folder";
  }
  const deleteCandidateLabels = useMemo(() => {
    if (!deleteCandidate) return [];

    const labels: string[] = [];
    deleteCandidate.noteIds.forEach((noteId) => {
      const note = notesById.get(noteId);
      labels.push(note ? getNoteTitle(note) : "Untitled note");
    });
    deleteCandidate.folderIds.forEach((folderId) => {
      const folder = foldersById.get(folderId);
      labels.push(folder ? folder.name : "Untitled folder");
    });
    return labels;
  }, [deleteCandidate, foldersById, notesById]);
  return (
    <Dialog
      open={Boolean(deleteCandidate)}
      onOpenChange={(open) => {
        if (!open && !isDeleting) {
          onCancel();
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{deleteDialogTitle}</DialogTitle>
          <DialogDescription>{deleteDialogDescription}</DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-(--app-border)/65 bg-(--app-page)/45 px-3 py-2 text-sm font-medium text-(--app-text)">
          {deleteCandidateLabels.length <= 1 ? (
            (deleteCandidateLabels[0] ?? "")
          ) : (
            <ul className="space-y-1">
              {deleteCandidateLabels.slice(0, 5).map((label, index) => (
                <li key={`${label}:${index}`} className="truncate">
                  {label}
                </li>
              ))}
              {deleteCandidateLabels.length > 5 ? (
                <li className="text-(--app-muted)">+{deleteCandidateLabels.length - 5} more</li>
              ) : null}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onCancel()}
            disabled={isDeleting}
          >
            {deleteDialogCancelLabel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void onConfirm()}
            disabled={isDeleting}
          >
            <Trash2Icon className="size-3.5" />
            {deleteDialogConfirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { FileOutputIcon, LibraryIcon } from "lucide-react";

import { useSecurityStatus } from "../settings/queries";
import { Button } from "@loam/notes-ui/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@loam/notes-ui/ui/Dialog";
import { Notice } from "@loam/notes-ui/ui/Notice";
import { useNotesWorkspace } from "@loam/notes-ui/workspace/NotesWorkspace";

import { useMarkdownExport } from "./useMarkdownExport";

/**
 * The one way to export: pick the open note or the whole library, then a folder. Opened from
 * the command palette and from Settings.
 */
export function ExportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { notes, activeNoteId } = useNotesWorkspace();
  const { exportNotes, isExporting } = useMarkdownExport();
  const security = useSecurityStatus();
  const activeNote = notes.find((note) => note.id === activeNoteId);
  const count = notes.length;

  const exportScope = (scope: Parameters<typeof exportNotes>[0]) => {
    onOpenChange(false);
    void exportNotes(scope);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Export as Markdown</DialogTitle>
          <DialogDescription>
            A folder of .md files, with images alongside, that opens in Obsidian and other editors.
          </DialogDescription>
        </DialogHeader>
        {security.data?.state === "on" ? (
          <Notice tone="warning">
            Your notes are encrypted, but an export isn't: anyone who can open the folder you export
            to can read them.
          </Notice>
        ) : null}
        <div className="grid gap-2">
          {activeNote ? (
            <Button
              variant="outline"
              className="justify-start"
              disabled={isExporting}
              onClick={() => exportScope({ kind: "note", noteId: activeNote.id })}
            >
              <FileOutputIcon className="size-4" aria-hidden="true" />
              <span className="truncate">This note: {activeNote.title || "Untitled"}</span>
            </Button>
          ) : null}
          <Button
            variant="outline"
            className="justify-start"
            disabled={isExporting || count === 0}
            onClick={() => exportScope({ kind: "all" })}
          >
            <LibraryIcon className="size-4" aria-hidden="true" />
            All notes ({count.toLocaleString()})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

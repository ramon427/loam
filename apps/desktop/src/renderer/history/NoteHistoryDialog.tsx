import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RotateCcwIcon } from "lucide-react";

import { callBridge } from "../bridge";
import { discardNoteEdits } from "../workspace/noteSaves";
import { saveAllNoteEdits, UNSAVED_EDITS_MESSAGE } from "../workspace/saveAllNoteEdits";
import { cn } from "../ui/cn";
import { Button } from "../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/Dialog";
import { Notice } from "../ui/Notice";
import { toastError, toastSuccess } from "../ui/toast";

import { NoteVersionPreview } from "./NoteVersionPreview";
import { errorMessage } from "../lib/errorMessage";
import { formatDateTime, formatSize } from "../lib/format";

export type HistoryTarget = { noteId: string; title: string };

/** A note's saved versions, to preview and restore one. */
export function NoteHistoryDialog({
  target,
  onClose,
  onRestored,
}: {
  target: HistoryTarget;
  onClose: () => void;
  onRestored: (noteId: string) => void;
}) {
  const history = useQuery({
    queryKey: ["note-history", target.noteId],
    queryFn: () => callBridge("notes.history", { noteId: target.noteId }),
    staleTime: 0,
  });
  const versions = history.data?.versions ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = versions.find((version) => version.id === selectedId) ?? versions[0] ?? null;
  const preview = useQuery({
    queryKey: ["note-version", target.noteId, selected?.id],
    queryFn: () => callBridge("notes.version", { noteId: target.noteId, versionId: selected!.id }),
    enabled: Boolean(selected),
  });
  const [restoring, setRestoring] = useState(false);

  const restore = async () => {
    if (!selected) return;
    setRestoring(true);
    try {
      if (!(await saveAllNoteEdits())) {
        toastError("Version not restored", { description: UNSAVED_EDITS_MESSAGE });
        setRestoring(false);
        return;
      }
      await callBridge("notes.restoreVersion", { noteId: target.noteId, versionId: selected.id });
      // The editor still holds the replaced content; nothing it holds may be saved over the restore.
      discardNoteEdits(target.noteId);
      onRestored(target.noteId);
      toastSuccess(
        `Restored "${target.title || "Untitled"}" to ${formatDateTime(selected.savedAt)}`,
        {
          description: "The content it replaced is in its version history.",
        },
      );
      onClose();
    } catch (error) {
      toastError("Version not restored", {
        description: errorMessage(error),
      });
      setRestoring(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open || restoring ? undefined : onClose())}>
      <DialogContent
        size="workspace"
        className="grid-cols-[280px_minmax(0,1fr)] overflow-hidden p-0"
      >
        <div className="flex min-h-0 flex-col gap-2 overflow-auto border-r border-(--app-border) bg-(--app-bg) px-3 py-5">
          <DialogTitle className="px-2 text-[15px] leading-5 font-semibold">
            Version history
          </DialogTitle>
          <DialogDescription className="px-2 text-[13px]">
            {target.title || "Untitled"}
          </DialogDescription>
          {history.isError ? (
            <Notice tone="danger">Could not read this note's history.</Notice>
          ) : null}
          {history.data && versions.length === 0 ? (
            <p className="px-2 text-[13px] text-(--app-muted)">
              No earlier versions yet. Loam keeps the content a note had before each editing
              session, and before it is deleted or restored.
            </p>
          ) : null}
          <ul aria-label="Versions">
            {versions.map((version) => (
              <li key={version.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-(--radius-control) p-2 text-left text-[13px] hover:bg-(--app-surface-2)",
                    version.id === selected?.id && "bg-(--app-surface-2)",
                  )}
                  aria-current={version.id === selected?.id ? "true" : undefined}
                  onClick={() => setSelectedId(version.id)}
                >
                  <span>{formatDateTime(version.savedAt)}</span>
                  <span className="text-[12px] text-(--app-muted)">
                    {version.title !== target.title ? `${version.title || "Untitled"} · ` : ""}
                    {formatSize(version.sizeBytes)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-h-0 min-w-0 overflow-auto px-8 py-5">
          {selected ? (
            <>
              <div className="mb-4 flex items-center justify-between gap-3 pr-8 text-[13px] font-semibold">
                <span>{formatDateTime(selected.savedAt)}</span>
                <Button
                  size="sm"
                  disabled={restoring || !preview.data}
                  onClick={() => void restore()}
                >
                  <RotateCcwIcon className="size-4" aria-hidden="true" />
                  {restoring ? "Restoring…" : "Restore this version"}
                </Button>
              </div>
              {preview.isError ? <Notice tone="danger">Could not open this version.</Notice> : null}
              {preview.data ? (
                <NoteVersionPreview noteId={target.noteId} note={preview.data.note} />
              ) : null}
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

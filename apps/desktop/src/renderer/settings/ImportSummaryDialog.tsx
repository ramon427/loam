import type { NotesImportSummary } from "../import-export/useNotesImport";
import { Button } from "../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/Dialog";

import styles from "./settings.module.css";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const describeResult = (summary: NotesImportSummary) => {
  if (summary.error) {
    const saved = plural(summary.noteCount, "note was", "notes were");
    return `The import from ${summary.name} stopped partway: ${summary.error} ${saved} saved before that.`;
  }
  const notes = plural(summary.noteCount, "note", "notes");
  const folders =
    summary.folderCount > 0
      ? ` and ${plural(summary.folderCount, "new folder", "new folders")}`
      : "";
  return `Added ${notes}${folders} from ${summary.name}.`;
};

/** What an import brought in and what it left out. */
export function ImportSummaryDialog({
  summary,
  onClose,
}: {
  summary: NotesImportSummary | null;
  onClose: () => void;
}) {
  if (!summary) return null;
  const skippedCount = summary.skipped.length + summary.moreSkipped;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{summary.error ? "Import stopped" : "Import finished"}</DialogTitle>
          <DialogDescription>{describeResult(summary)}</DialogDescription>
        </DialogHeader>
        {skippedCount > 0 ? (
          <div className={styles.importSkipped}>
            <p>{plural(skippedCount, "item was", "items were")} not imported:</p>
            <ul>
              {summary.skipped.map((skip) => (
                <li key={`${skip.path}\n${skip.reason}`}>
                  <span className={styles.importSkippedPath}>{skip.path}</span>
                  <span className={styles.importSkippedReason}>{skip.reason}</span>
                </li>
              ))}
              {summary.moreSkipped > 0 ? (
                <li>{plural(summary.moreSkipped, "more item", "more items")}</li>
              ) : null}
            </ul>
          </div>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

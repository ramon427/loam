import { FileOutputIcon, FileInputIcon } from "lucide-react";
import { useState, type DragEvent } from "react";

import { ExportDialog } from "../import-export/ExportDialog";
import { useNotesImport, type NotesImportProgress } from "../import-export/useNotesImport";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { toastError } from "../ui/toast";
import { useNotesWorkspace } from "../workspace/NotesWorkspace";

import { ImportSummaryDialog } from "./ImportSummaryDialog";
import {
  SettingsDetails,
  SettingsNote,
  SettingsRow,
  SettingsSection,
  useSettingsBusy,
} from "./SettingsLayout";
import styles from "./settings.module.css";

const describeProgress = (progress: NotesImportProgress) => {
  if (progress.phase === "reading") return "Reading files…";
  if (progress.phase === "converting")
    return `Converting notes… ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}`;
  return `Saving notes… ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}`;
};

/** Brings notes in from other apps and copies them out as plain files. */
export function ImportExportSettings() {
  const [exportOpen, setExportOpen] = useState(false);
  const { reloadLibrary } = useNotesWorkspace();
  const { importNotes, progress, summary, dismissSummary } = useNotesImport({
    onImported: reloadLibrary,
  });
  const busy = progress !== null;
  useSettingsBusy(busy);
  const [dragging, setDragging] = useState(false);
  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    // Folders and files from this computer have a path; things dragged from a page don't.
    const paths = [...event.dataTransfer.files].flatMap((file) => {
      const path = window.loam.pathForFile(file);
      return path ? [path] : [];
    });
    if (paths.length === 0)
      toastError("Nothing to import", {
        description: "Drop a folder or files from this computer.",
      });
    else void importNotes(paths);
  };

  return (
    <>
      <SettingsSection
        title="Import"
        description="Add notes from another app. Your existing notes stay as they are."
      >
        <div
          // The window's own drop handler opens dropped files; here they are imported instead.
          data-takes-file-drops=""
          className={cn(
            "rounded-(--radius-control) border border-dashed border-transparent transition-colors",
            dragging && "border-(--app-accent) bg-(--app-accent)/5",
          )}
          onDragOver={(event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setDragging(false);
          }}
          onDrop={drop}
        >
          <SettingsRow
            title="Markdown or Obsidian, Evernote, Notion or web pages"
            description="Pick the files, or drop a folder or files here. Loam tells what they are."
            control={
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void importNotes()}
              >
                <FileInputIcon className="size-4" aria-hidden="true" />
                Import…
              </Button>
            }
          />
        </div>
        {progress ? (
          <p className={styles.note} role="status">
            {describeProgress(progress)}
          </p>
        ) : null}
      </SettingsSection>
      <SettingsSection
        title="Export"
        description="Save the open note or your whole library as Markdown files that open in Obsidian and other editors."
      >
        <SettingsRow
          title="Markdown"
          description="A folder of .md files, with images alongside."
          control={
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setExportOpen(true)}>
              <FileOutputIcon className="size-4" aria-hidden="true" />
              Export…
            </Button>
          }
        />
        <SettingsDetails label="What’s included in an export?">
          <SettingsNote>
            Folders stay folders, links become [[wikilinks]], diagrams also get a .canvas file, and
            images are copied to attachments.
          </SettingsNote>
        </SettingsDetails>
      </SettingsSection>
      <ImportSummaryDialog summary={summary} onClose={dismissSummary} />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
    </>
  );
}

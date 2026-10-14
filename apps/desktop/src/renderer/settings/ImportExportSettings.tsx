import { FileOutputIcon, FileInputIcon } from "lucide-react";

import type { BridgeImportSource } from "@loam/shared/bridge/loamBridge";
import { useMarkdownExport } from "../import-export/useMarkdownExport";
import { useNotesImport, type NotesImportProgress } from "../import-export/useNotesImport";
import { Button } from "../ui/Button";
import { useNotesWorkspace } from "../workspace/NotesWorkspace";

import { ImportSummaryDialog } from "./ImportSummaryDialog";
import { useSecurityStatus } from "./queries";
import {
  SettingsDetails,
  SettingsNote,
  SettingsNotice,
  SettingsRow,
  SettingsSection,
  useSettingsBusy,
} from "./SettingsLayout";
import styles from "./settings.module.css";

const IMPORT_SOURCES: { source: BridgeImportSource; label: string; button: string }[] = [
  { source: "markdown", label: "Markdown or Obsidian", button: "Import a folder…" },
  { source: "evernote", label: "Evernote", button: "Import .enex files…" },
  { source: "notion", label: "Notion", button: "Import a .zip export…" },
  { source: "html", label: "Web pages (HTML)", button: "Import .html files…" },
];

const describeProgress = (progress: NotesImportProgress) => {
  if (progress.phase === "reading") return "Reading files…";
  if (progress.phase === "converting")
    return `Converting notes… ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}`;
  return `Saving notes… ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}`;
};

/** Brings notes in from other apps and copies them out as plain files. */
export function ImportExportSettings() {
  const { exportNotes, isExporting } = useMarkdownExport();
  const { reloadLibrary } = useNotesWorkspace();
  const { importNotes, progress, summary, dismissSummary } = useNotesImport({
    onImported: reloadLibrary,
  });
  const security = useSecurityStatus();
  const busy = progress !== null || isExporting;
  useSettingsBusy(busy);

  return (
    <>
      <SettingsSection
        title="Import"
        description="Add notes from another app. Your existing notes stay as they are."
      >
        {IMPORT_SOURCES.map(({ source, label, button }) => (
          <SettingsRow
            key={source}
            title={label}
            control={
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void importNotes(source)}
              >
                <FileInputIcon className="size-4" aria-hidden="true" />
                {button}
              </Button>
            }
          />
        ))}
        {progress ? (
          <p className={styles.note} role="status">
            {describeProgress(progress)}
          </p>
        ) : null}
      </SettingsSection>
      <SettingsSection
        title="Export"
        description="Save your whole library as Markdown files that open in Obsidian and other editors."
      >
        {security.data?.state === "on" ? (
          <SettingsNotice tone="warning">
            Your notes are encrypted, but an export isn't: anyone who can open the folder you export
            to can read them.
          </SettingsNotice>
        ) : null}
        <SettingsRow
          title="Markdown"
          description="A folder of .md files, with images alongside."
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void exportNotes({ kind: "all" })}
            >
              <FileOutputIcon className="size-4" aria-hidden="true" />
              {isExporting ? "Exporting…" : "Export all notes…"}
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
    </>
  );
}

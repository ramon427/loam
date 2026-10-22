import { useCallback, useRef, useState } from "react";

import { callBridge } from "../bridge";
import { saveAllNoteEdits } from "@loam/notes-ui/workspace/saveAllNoteEdits";
import type { BridgeImportSkip } from "@loam/shared/bridge/loamBridge";
import { toastError, toastWarning } from "@loam/notes-ui/ui/toast";

import { convertImport } from "./convertImport";
import { errorMessage } from "@loam/notes-ui/lib/errorMessage";

/** Notes per bridge call, so a large import never sends everything at once. */
const WRITE_BATCH_SIZE = 100;
const SUMMARY_SKIPPED_LIMIT = 200;

export type NotesImportSummary = {
  name: string;
  noteCount: number;
  folderCount: number;
  skipped: BridgeImportSkip[];
  /** How many skipped items were left out of `skipped` to keep it short. */
  moreSkipped: number;
  /** Set when the import stopped partway; `noteCount` notes were saved before that. */
  error?: string;
};

export type NotesImportProgress =
  | { phase: "reading" }
  | { phase: "converting"; done: number; total: number }
  | { phase: "saving"; done: number; total: number };

/**
 * Imports notes from another app, picked or dropped; the main process tells
 * which app's export it is. Open edits are saved first, nothing may be edited meanwhile (the caller blocks the screen while `progress` is set),
 * and `onImported` runs once notes were written, so the library shows them.
 * Whatever happens after the pick, the import is finished, so the notes
 * written so far land in their folders.
 */
export function useNotesImport({ onImported }: { onImported: () => void }) {
  const runningRef = useRef(false);
  const [progress, setProgress] = useState<NotesImportProgress | null>(null);
  const [summary, setSummary] = useState<NotesImportSummary | null>(null);

  const importNotes = useCallback(
    /** `dropped` names paths dropped on the window; without it the picker opens. */
    async (dropped?: string[]) => {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        if (!(await saveAllNoteEdits())) {
          toastError("Import not started", {
            description: "Some changes haven't been saved yet. Resolve them, then import again.",
          });
          return;
        }
        setProgress({ phase: "reading" });
        const picked = dropped
          ? await callBridge("import.pickDropped", { paths: dropped })
          : await callBridge("import.pick", {});
        if (picked.status === "canceled") return;
        const { source } = picked;

        let skipped = picked.skipped;
        let written = 0;
        let failure: string | undefined;
        try {
          setProgress({ phase: "converting", done: 0, total: picked.files.length });
          const converted = await convertImport({
            source,
            sessionId: picked.sessionId,
            files: picked.files,
            onProgress: (done, total) => setProgress({ phase: "converting", done, total }),
          });
          skipped = [...skipped, ...converted.skipped];
          for (let start = 0; start < converted.notes.length; start += WRITE_BATCH_SIZE) {
            setProgress({ phase: "saving", done: start, total: converted.notes.length });
            const batch = converted.notes.slice(start, start + WRITE_BATCH_SIZE);
            written += (
              await callBridge("import.write", { sessionId: picked.sessionId, notes: batch })
            ).written;
          }
        } catch (error) {
          failure = errorMessage(error);
        }
        const result = await callBridge("import.finish", { sessionId: picked.sessionId });
        if (written === 0) {
          if (failure) toastError("Import failed", { description: failure });
          else
            toastWarning(`Nothing to import from ${picked.name}`, {
              description: "No notes were found in what you picked.",
            });
          return;
        }
        onImported();
        setSummary({
          name: picked.name,
          noteCount: result.noteCount,
          folderCount: result.folderCount,
          skipped: skipped.slice(0, SUMMARY_SKIPPED_LIMIT),
          moreSkipped: Math.max(0, skipped.length - SUMMARY_SKIPPED_LIMIT),
          error: failure,
        });
      } catch (error) {
        toastError("Import failed", {
          description: errorMessage(error),
        });
      } finally {
        runningRef.current = false;
        setProgress(null);
      }
    },
    [onImported],
  );

  return { importNotes, progress, summary, dismissSummary: () => setSummary(null) };
}

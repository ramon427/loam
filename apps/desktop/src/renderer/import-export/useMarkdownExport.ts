import { useCallback, useRef, useState } from "react";

import { callBridge } from "../bridge";
import { saveAllNoteEdits } from "../workspace/saveAllNoteEdits";
import type { BridgeExportScope } from "@loam/shared/bridge/loamBridge";
import { toastError, toastSuccess, toastWarning } from "../ui/toast";
import { errorMessage } from "../lib/errorMessage";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Exports notes as Markdown after the open note's latest edits are saved, then reports
 * the result with a shortcut to the new folder. Shared by Settings and the note menu.
 */
export function useMarkdownExport() {
  const runningRef = useRef(false);
  const [isExporting, setIsExporting] = useState(false);

  const exportNotes = useCallback(async (scope: BridgeExportScope) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setIsExporting(true);
    try {
      const saved = await saveAllNoteEdits();
      const result = await callBridge("export.markdown", { scope });
      if (result.status === "canceled") return;
      const notes = plural(result.noteCount, "note", "notes");
      const problems = [
        saved ? null : "Your latest unsaved edits are not included.",
        result.missingImages > 0
          ? `${plural(result.missingImages, "image was", "images were")} not found and left out.`
          : null,
      ].filter(Boolean);
      const action = { label: "Show folder", onClick: () => void callBridge("export.reveal", {}) };
      if (problems.length > 0)
        toastWarning(`Exported ${notes}`, { description: problems.join(" "), action });
      else toastSuccess(`Exported ${notes}`, { action });
    } catch (error) {
      toastError("Export failed", {
        description: errorMessage(error),
      });
    } finally {
      runningRef.current = false;
      setIsExporting(false);
    }
  }, []);

  return { exportNotes, isExporting };
}

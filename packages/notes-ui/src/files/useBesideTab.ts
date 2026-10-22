import { useCallback, useState } from "react";

import { readPreference, removePreference, writePreference } from "../lib/preferences";

const besideKey = (noteId: string) => `beside-tab:${noteId}`;

const readTabId = (value: unknown) => (typeof value === "string" ? value : null);

/** Forgets which tab a deleted note showed beside it. */
export const forgetBesideTab = (noteId: string) => removePreference(besideKey(noteId));

/**
 * The file tab a note shows beside itself, in the column the video uses,
 * kept per note on this computer as the video pane's state is.
 */
export function useBesideTab(noteId: string) {
  const [tabId, setTabId] = useState(() => readPreference(besideKey(noteId), readTabId));
  const setBeside = useCallback(
    (next: string | null) => {
      setTabId(next);
      if (next) writePreference(besideKey(noteId), next);
      else removePreference(besideKey(noteId));
    },
    [noteId],
  );
  return [tabId, setBeside] as const;
}

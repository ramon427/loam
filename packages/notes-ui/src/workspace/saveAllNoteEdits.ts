import { saveNoteEdits } from "./noteSaves";

/** Why work that needs every edit saved didn't start. */
export const UNSAVED_EDITS_MESSAGE =
  "Some changes haven't been saved yet. Resolve them, then try again.";

/**
 * Saves every note's edits now. Work that reads notes outside the editor
 * (export, import, backups, version restore) runs this first. False if a save
 * failed.
 */
export async function saveAllNoteEdits(): Promise<boolean> {
  try {
    await saveNoteEdits();
    return true;
  } catch {
    return false;
  }
}

/** Saves every note's edits now, throwing `UNSAVED_EDITS_MESSAGE` if a save failed. */
export async function saveAllNoteEditsOrThrow(): Promise<void> {
  if (!(await saveAllNoteEdits())) throw new Error(UNSAVED_EDITS_MESSAGE);
}

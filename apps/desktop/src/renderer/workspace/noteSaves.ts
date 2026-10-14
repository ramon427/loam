import { BridgeError, callBridge } from "../bridge";
import type {
  ConflictCopy,
  NoteContent,
  NoteDocument,
  NotePatch,
} from "@loam/shared/notes/noteModel";
import { removeBrokenHeadingConnections } from "@loam/shared/notes/headingConnections";
import { isRecord } from "@loam/shared/utils/isRecord";
import { createUuid } from "@loam/shared/utils/uuid";

/**
 * Saves edits to notes. An edit marks which fields of a note changed; they
 * are saved after a short pause, when the note is left, or when asked. Each
 * note has at most one save in flight, and edits made meanwhile follow it.
 *
 * Edits not yet saved are also kept in localStorage, written shortly after
 * each edit and again as the window closes, so quitting or a crashed window
 * loses nothing: the next launch saves them before it reads the library.
 *
 * Each save names the version of the note its edits were made to, so the
 * store can tell when sync replaced that version meanwhile and keep it.
 */

export type NoteField = keyof NoteContent;

type PendingNote = {
  note: NoteDocument;
  fields: Set<NoteField>;
  timer: ReturnType<typeof setTimeout> | null;
  saving: Promise<void> | null;
  failed: boolean;
};

export type NoteSaveStatus = "saved" | "saving" | "unsaved" | "failed";

const SAVE_DELAY_MS = 800;
const DRAFT_DELAY_MS = 250;
const DRAFTS_KEY = "loam:unsaved-edits";
/** Kept edits a launch could not save; tried again on each launch, never overwritten. */
const RETRY_KEY = "loam:unsaved-edits-retry";

/** Edits to one note as kept for the next launch, with the version they were made to. */
type KeptEdits = { patch: NotePatch; base?: string };

const pending = new Map<string, PendingNote>();
/** The version of each note the window last read or saved (its `updatedAt`). */
const knownVersions = new Map<string, string>();
const savedListeners = new Set<(noteId: string, conflictCopy?: ConflictCopy) => void>();
let draftTimer: ReturnType<typeof setTimeout> | null = null;

/** Fields that hold blocks or what headings connect to. */
const BODY_FIELDS: ReadonlySet<NoteField> = new Set([
  "tabs",
  "blocksByTab",
  "graphsByTab",
  "tablesByTab",
  "graph",
]);

type StoredBlock = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content: unknown;
  children: StoredBlock[];
};

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * A block as plain JSON with every field the editor reads. A block without an
 * id gets one here, so headings keep their connections across launches.
 */
const toStoredBlock = (value: unknown): StoredBlock => {
  const block = isRecord(value) ? value : {};
  return {
    id: typeof block.id === "string" ? block.id : createUuid(),
    type: typeof block.type === "string" ? block.type : "paragraph",
    props: isRecord(block.props) ? cloneJson(block.props) : {},
    content: block.content === undefined ? null : cloneJson(block.content),
    children: Array.isArray(block.children) ? block.children.map(toStoredBlock) : [],
  };
};

/** The fields as the store should keep them: stored blocks, valid heading links. */
const buildPatch = (note: NoteDocument, fields: ReadonlySet<NoteField>): NotePatch => {
  let source: NoteContent = note;
  if ([...fields].some((field) => BODY_FIELDS.has(field))) {
    const blocksByTab = Object.fromEntries(
      Object.entries(note.blocksByTab).map(([tabId, blocks]) => [tabId, blocks.map(toStoredBlock)]),
    );
    source = removeBrokenHeadingConnections({ ...note, blocksByTab });
  }
  const patch: NotePatch = {};
  for (const field of fields) Object.assign(patch, { [field]: source[field] ?? null });
  return patch;
};

const baseOf = (note: NoteDocument) => knownVersions.get(note.id) ?? note.updatedAt;

/** Records the version of a note the window read, so its edits name it. */
export const noteRead = (note: NoteDocument) => {
  knownVersions.set(note.id, note.updatedAt);
};

const writeDrafts = () => {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = null;
  const drafts = Object.fromEntries(
    [...pending]
      .filter(([, entry]) => entry.fields.size > 0)
      .map(([noteId, entry]): [string, KeptEdits] => [
        noteId,
        { patch: buildPatch(entry.note, entry.fields), base: baseOf(entry.note) },
      ]),
  );
  try {
    if (Object.keys(drafts).length === 0) localStorage.removeItem(DRAFTS_KEY);
    else localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    return true;
  } catch {
    return false;
  }
};

/** A note saved now supersedes any edit to it an earlier launch couldn't save. */
const dropRetriedEdits = (noteId: string) => {
  try {
    const retry = localStorage.getItem(RETRY_KEY);
    if (!retry) return;
    const drafts = JSON.parse(retry) as Record<string, unknown>;
    if (!(noteId in drafts)) return;
    delete drafts[noteId];
    if (Object.keys(drafts).length === 0) localStorage.removeItem(RETRY_KEY);
    else localStorage.setItem(RETRY_KEY, JSON.stringify(drafts));
  } catch {
    // Unreadable or unavailable storage holds nothing to drop.
  }
};

const scheduleDrafts = () => {
  draftTimer ??= setTimeout(writeDrafts, DRAFT_DELAY_MS);
};

/** Saves after `delay`, unless a save is already scheduled or running. */
const scheduleSave = (noteId: string, entry: PendingNote, delay: number) => {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    if (!entry.saving && entry.fields.size > 0) void runSave(noteId, entry).catch(() => undefined);
  }, delay);
};

const runSave = (noteId: string, entry: PendingNote): Promise<void> => {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  const fields = new Set(entry.fields);
  const patch = buildPatch(entry.note, fields);
  entry.fields.clear();
  entry.saving = callBridge("notes.save", {
    noteId,
    patch,
    baseUpdatedAt: baseOf(entry.note),
  }).then(
    (saved) => {
      knownVersions.set(noteId, saved.updatedAt);
      entry.saving = null;
      entry.failed = false;
      // Edits made during the save follow it.
      if (entry.fields.size === 0) pending.delete(noteId);
      else if (!entry.timer) scheduleSave(noteId, entry, 0);
      // Right away, so a draft never holds content older than what is stored.
      writeDrafts();
      dropRetriedEdits(noteId);
      for (const listener of savedListeners) listener(noteId, saved.conflictCopy);
    },
    (error: unknown) => {
      entry.saving = null;
      // A deleted note has nothing left to save.
      if (error instanceof BridgeError && error.code === "NOT_FOUND") {
        pending.delete(noteId);
      } else {
        for (const field of fields) entry.fields.add(field);
        entry.failed = true;
      }
      writeDrafts();
      throw error;
    },
  );
  return entry.saving;
};

/** Records that `fields` of `note` changed; `note` is its newest state. */
export const recordNoteEdit = (note: NoteDocument, fields: Iterable<NoteField>) => {
  let entry = pending.get(note.id);
  if (!entry) {
    entry = { note, fields: new Set(), timer: null, saving: null, failed: false };
    pending.set(note.id, entry);
  }
  entry.note = note;
  for (const field of fields) entry.fields.add(field);
  if (entry.fields.size === 0) return;
  scheduleSave(note.id, entry, SAVE_DELAY_MS);
  scheduleDrafts();
};

/** Saves a note's edits now, or every note's; resolves once they are stored. */
export async function saveNoteEdits(noteId?: string): Promise<void> {
  const ids = noteId ? [noteId] : [...pending.keys()];
  await Promise.all(
    ids.map(async (id) => {
      for (let entry = pending.get(id); entry; entry = pending.get(id)) {
        if (entry.saving) await entry.saving;
        else if (entry.fields.size > 0) await runSave(id, entry);
        else return;
      }
    }),
  );
}

/** Forgets edits to a note that is being deleted. */
export const discardNoteEdits = (noteId: string) => {
  const entry = pending.get(noteId);
  if (entry?.timer) clearTimeout(entry.timer);
  if (entry && !entry.saving) pending.delete(noteId);
  else entry?.fields.clear();
  writeDrafts();
};

/** A note as the store holds it, with the edits to it that aren't saved yet on top. */
export const withUnsavedEdits = <TNote extends NoteDocument>(note: TNote): TNote => {
  const entry = pending.get(note.id);
  if (!entry || entry.fields.size === 0) return note;
  const edited = { ...note };
  for (const field of entry.fields) Object.assign(edited, { [field]: entry.note[field] });
  return edited;
};

export const readNoteSaveStatus = (noteId: string): NoteSaveStatus => {
  const entry = pending.get(noteId);
  if (!entry) return "saved";
  if (entry.failed) return "failed";
  return entry.saving ? "saving" : "unsaved";
};

/** Calls `listener` after each successful save of a note, with any conflict copy it made. */
export const onNoteSaved = (listener: (noteId: string, conflictCopy?: ConflictCopy) => void) => {
  savedListeners.add(listener);
  return () => void savedListeners.delete(listener);
};

/**
 * Keeps unsaved edits through a window close. Returns false if they could not
 * be written, so the caller can ask before closing.
 */
export const keepUnsavedEditsOnClose = () => writeDrafts();

/** Kept edits; older versions of the app kept the patch alone. */
const readKeptEdits = (value: unknown): KeptEdits =>
  value && typeof value === "object" && "patch" in value
    ? (value as KeptEdits)
    : { patch: value as NotePatch };

const readDrafts = (key: string): Array<[string, KeptEdits]> => {
  try {
    return Object.entries(
      JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>,
    ).map(([noteId, value]) => [noteId, readKeptEdits(value)]);
  } catch {
    return [];
  }
};

/**
 * Saves edits earlier sessions kept in localStorage, oldest first. Run before
 * any note is read. Edits the store can't take now are kept for the next
 * launch, apart from this session's own kept edits so those can't replace them.
 */
export async function saveEditsFromLastSession() {
  // One patch per note, newer fields over older ones, made to the oldest version.
  const kept = new Map<string, KeptEdits>();
  for (const [noteId, edits] of [...readDrafts(RETRY_KEY), ...readDrafts(DRAFTS_KEY)]) {
    const earlier = kept.get(noteId);
    kept.set(noteId, {
      patch: { ...earlier?.patch, ...edits.patch },
      base: earlier ? earlier.base : edits.base,
    });
  }
  const failed: Record<string, KeptEdits> = {};
  for (const [noteId, edits] of kept) {
    try {
      await callBridge("notes.save", { noteId, patch: edits.patch, baseUpdatedAt: edits.base });
    } catch (error) {
      // A note deleted since has nothing to save.
      if (!(error instanceof BridgeError && error.code === "NOT_FOUND")) failed[noteId] = edits;
    }
  }
  try {
    localStorage.removeItem(DRAFTS_KEY);
    if (Object.keys(failed).length === 0) localStorage.removeItem(RETRY_KEY);
    else localStorage.setItem(RETRY_KEY, JSON.stringify(failed));
  } catch {
    // Nothing to keep if storage is unavailable.
  }
}

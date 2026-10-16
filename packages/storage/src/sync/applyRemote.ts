import type {
  NoteConflict,
  NoteContent,
  NoteFolder,
  NoteProject,
  NotesChange,
} from "@loam/shared/notes/noteModel";

import type { StorageWrite } from "../adapter";
import { foldersWrite, toFolder } from "../folders";
import {
  buildNoteRow,
  nextPosition,
  noteWrites,
  placeRow,
  sameContent,
  toNoteContent,
  trashWrites,
  type NoteRow,
  type StoredNote,
} from "../noteContent";
import { projectsWrite } from "../projects";
import { decideGroup, decideNote, decidePlace } from "./resolve";
import {
  isChangeOf,
  parseSyncKey,
  syncKey,
  type PlaceValue,
  type SyncChange,
  type SyncChangeOf,
  type SyncDocKey,
} from "./syncDocs";
import type { IncomingOrder, SyncLedger } from "./syncLedger";

/**
 * Applying a change from another device to the store: which version stays
 * (`resolve.ts` decides), and the writes that make it so, including keeping
 * the version that lost a conflict. The store runs these one at a time, between its other requests.
 */

/** What applying a change reads from and writes to the store. */
export type RemoteApplyStore = {
  ledger: SyncLedger;
  now: () => number;
  findNote: (noteId: string) => Promise<StoredNote | null>;
  readRows: () => Promise<Map<string, NoteRow>>;
  readFolders: () => Promise<NoteFolder[]>;
  readProjects: () => Promise<NoteProject[]>;
  /** Adds writes that keep `previous` as a version of the note, if the history rules say so. */
  keepVersion: (
    writes: StorageWrite[],
    noteId: string,
    previous: StoredNote,
    force: boolean,
  ) => Promise<void>;
  /** Adds writes that keep a version that lost a conflict in the note's history for good. */
  keepConflict: (
    writes: StorageWrite[],
    noteId: string,
    loser: { content: NoteContent; updatedAt: string },
  ) => Promise<NoteConflict | null>;
  /** Commits `writes`; `changed` names documents to publish from this device. */
  commit: (writes: StorageWrite[], changed?: readonly SyncDocKey[]) => Promise<void>;
  /** Records that a note's content, saved at `updatedAt`, came from another device. */
  markRemote: (noteId: string, updatedAt: string) => void;
};

type Order = Exclude<IncomingOrder, "skip">;

/**
 * Applies a note's change as `decideNote` says. The losing version is kept in the note's
 * history on this device, which has both; history doesn't sync, and every device that sees
 * the conflict keeps it.
 */
const applyRemoteNote = async (
  store: RemoteApplyStore,
  noteId: string,
  change: SyncChangeOf<"note">,
  order: Order,
  result: NotesChange,
) => {
  const { ledger } = store;
  const local = await store.findNote(noteId);
  const incoming = change.value;
  const writes: StorageWrite[] = [];
  const current = local ? toNoteContent(local.row, local.content) : null;
  const heldClock = ledger.heldClock(change.key);
  const incomingAt = new Date(change.savedAt).toISOString();
  const same = sameContent(current, incoming);
  const decided = decideNote(
    { order, incomingClock: change.clock, heldClock },
    { local: Boolean(current), incoming: Boolean(incoming), same },
  );
  const { kept } = decided;
  // The author won a conflict over the version held here: it lost, though this device
  // never saw the two side by side.
  const overridden =
    kept === "incoming" && current && incoming && !same && change.overrode?.includes(heldClock);
  const lost = decided.lost ?? (overridden ? "local" : null);
  if (lost) {
    const loser =
      lost === "incoming"
        ? { content: incoming!, updatedAt: incomingAt }
        : { content: current!, updatedAt: local!.row.updatedAt };
    const conflict = await store.keepConflict(writes, noteId, loser);
    if (conflict) result.conflicts.push({ ...conflict, title: current!.title });
  }
  if (kept === "incoming" && incoming) {
    let placement: PlaceValue | undefined = local?.row;
    if (!placement) {
      const pending = ledger.takePendingPlace(syncKey("place", noteId));
      if (pending) writes.push(pending.write);
      placement = pending?.place ?? {
        folderId: null,
        position: nextPosition((await store.readRows()).values(), { folderId: null }),
      };
    }
    // A local version that lost is kept as the conflict already.
    if (local && lost !== "local") await store.keepVersion(writes, noteId, local, false);
    writes.push(...noteWrites(buildNoteRow(noteId, incoming, placement, incomingAt), incoming));
    store.markRemote(noteId, incomingAt);
    result.changedNoteIds.push(noteId);
  } else if (kept === "incoming" && local) {
    await store.keepVersion(writes, noteId, local, true);
    writes.push(...trashWrites(local, store.now()));
    result.deletedNoteIds.push(noteId);
  }
  writes.push(...ledger.recordIncoming(change, kept));
  await store.commit(writes);
};

/** Moves a note as `decidePlace` says; a place for a note not here yet waits for it. */
const applyRemotePlace = async (
  store: RemoteApplyStore,
  noteId: string,
  change: SyncChangeOf<"place">,
  order: Order,
  result: NotesChange,
) => {
  const place = change.value;
  const kept = decidePlace({
    order,
    incomingClock: change.clock,
    heldClock: store.ledger.heldClock(change.key),
  });
  const writes: StorageWrite[] = [];
  let pending: PlaceValue | undefined;
  if (kept === "incoming" && place) {
    const row = (await store.readRows()).get(noteId);
    if (row) {
      writes.push({ type: "put", collection: "notes", id: noteId, value: placeRow(row, place) });
      result.layoutChanged = true;
    } else pending = place;
  }
  writes.push(...store.ledger.recordIncoming(change, kept, pending));
  await store.commit(writes);
};

/**
 * Changes, adds or removes a folder or project as `decideGroup` says.
 * `groups` is every stored one of its kind, `incoming` the change's version
 * of this one, and `write` stores them. Folders
 * and notes in a project another device deleted stay put until they move;
 * the library shows them at the top level.
 */
const applyRemoteGroup = async <T extends { id: string; position: number }>(
  store: RemoteApplyStore,
  id: string,
  change: SyncChangeOf<"folder"> | SyncChangeOf<"project">,
  order: Order,
  result: NotesChange,
  {
    groups,
    incoming,
    write,
  }: { groups: T[]; incoming: T | null; write: (groups: T[]) => StorageWrite },
) => {
  const kept = decideGroup(
    { order, incomingClock: change.clock, heldClock: store.ledger.heldClock(change.key) },
    { local: groups.some((group) => group.id === id), incoming: Boolean(incoming) },
  );
  const writes: StorageWrite[] = [];
  if (kept === "incoming") {
    const next = groups.filter((group) => group.id !== id);
    if (incoming) next.push(incoming);
    next.sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
    writes.push(write(next));
    result.layoutChanged = true;
  }
  writes.push(...store.ledger.recordIncoming(change, kept));
  await store.commit(writes);
};

/**
 * Applies one change from another device in one commit, adding what it did
 * to `result`. A change the ledger already holds is skipped. The ledger must
 * have every sync record loaded.
 */
export const applyRemoteChange = async (
  store: RemoteApplyStore,
  change: SyncChange,
  result: NotesChange,
) => {
  const order = store.ledger.order(change);
  if (order === "skip") return;
  const { id } = parseSyncKey(change.key)!;
  if (isChangeOf(change, "note")) return applyRemoteNote(store, id, change, order, result);
  if (isChangeOf(change, "place")) return applyRemotePlace(store, id, change, order, result);
  if (isChangeOf(change, "folder"))
    return applyRemoteGroup(store, id, change, order, result, {
      groups: await store.readFolders(),
      incoming: change.value && toFolder(id, change.value),
      write: foldersWrite,
    });
  return applyRemoteGroup(store, id, change, order, result, {
    groups: await store.readProjects(),
    incoming: change.value && { id, ...change.value },
    write: projectsWrite,
  });
};

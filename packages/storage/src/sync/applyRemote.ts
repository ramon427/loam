import type {
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
  type NotePlace,
  type NoteRow,
  type StoredNote,
} from "../noteContent";
import { projectsWrite } from "../projects";
import { decideGroup, decideNote, decidePlace } from "./resolve";
import {
  conflictCopyId,
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
 * (`resolve.ts` decides), and the writes that make it so, including conflict
 * copies. The store runs these one at a time, between its other requests.
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
  /** Commits `writes`; `changed` names documents to publish from this device. */
  commit: (writes: StorageWrite[], changed?: readonly SyncDocKey[]) => Promise<void>;
  /** Records that a note's content, saved at `updatedAt`, came from another device. */
  markRemote: (noteId: string, updatedAt: string) => void;
};

type Order = Exclude<IncomingOrder, "skip">;

/**
 * Adds a note holding a version that lost a conflict, at the end of the
 * original's place. Each version gets one copy, the same on every device
 * (it carries the version's own save time), and a copy someone already
 * deleted is not made again. A user's edit to a version sync or an AI client
 * replaced makes one too.
 */
export const addConflictCopy = async (
  store: Pick<RemoteApplyStore, "ledger" | "readRows">,
  writes: StorageWrite[],
  changed: SyncDocKey[],
  noteId: string,
  loser: { content: NoteContent; clock: string; updatedAt: string; place: NotePlace },
) => {
  const id = conflictCopyId(noteId, loser.clock);
  const rows = await store.readRows();
  if (rows.has(id) || (await store.ledger.read(syncKey("note", id)))) return null;
  const title = `${loser.content.title || "Untitled"} (conflict copy)`;
  const content = { ...loser.content, title };
  const { folderId, projectId } = loser.place;
  const position = nextPosition(rows.values(), loser.place);
  const row = buildNoteRow(id, content, { folderId, projectId, position }, loser.updatedAt);
  writes.push(...noteWrites(row, content));
  changed.push(syncKey("note", id), syncKey("place", id));
  return { id, title };
};

/** Applies a note's change as `decideNote` says, keeping the losing version as a conflict copy. */
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
  const changed: SyncDocKey[] = [];
  const current = local ? toNoteContent(local.row, local.content) : null;
  const heldClock = ledger.heldClock(change.key);
  const incomingAt = new Date(change.savedAt).toISOString();
  const { kept, copy } = decideNote(
    { order, incomingClock: change.clock, heldClock },
    {
      local: Boolean(current),
      incoming: Boolean(incoming),
      same: sameContent(current, incoming),
    },
  );
  if (copy) {
    const loser =
      copy === "incoming"
        ? { content: incoming!, clock: change.clock, updatedAt: incomingAt }
        : { content: current!, clock: heldClock, updatedAt: local!.row.updatedAt };
    const conflictCopy = await addConflictCopy(store, writes, changed, noteId, {
      ...loser,
      place: local?.row ?? { folderId: null },
    });
    if (conflictCopy) result.conflictCopies.push(conflictCopy);
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
    if (local) await store.keepVersion(writes, noteId, local, false);
    writes.push(...noteWrites(buildNoteRow(noteId, incoming, placement, incomingAt), incoming));
    store.markRemote(noteId, incomingAt);
    result.changedNoteIds.push(noteId);
  } else if (kept === "incoming" && local) {
    await store.keepVersion(writes, noteId, local, true);
    writes.push(...trashWrites(local, store.now()));
    result.deletedNoteIds.push(noteId);
  }
  writes.push(...ledger.recordIncoming(change, kept));
  await store.commit(writes, changed);
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

import type {
  NoteBacklinks,
  NoteConflict,
  NoteContent,
  NoteContentSearchResponse,
  NoteDocument,
  NoteHistory,
  NotesBootstrap,
  NotesChange,
  NoteTrashEntry,
  NoteVersion,
  SavedNote,
} from "@loam/shared/notes/noteModel";
import { resolveNoteParents } from "@loam/shared/notes/noteParents";
import { isRecord } from "@loam/shared/utils/isRecord";
import { stableJsonStringify } from "@loam/shared/utils/stableJson";

import {
  type StorageAdapter,
  type StorageCollection,
  type StorageSnapshotRecord,
  type StorageWrite,
} from "./adapter";
import { arrangeNotes, FOLDERS_ID, foldersWrite, readLayout, toFolder } from "./folders";
import { migrateStore } from "./migrations";
import {
  applyNotePatch,
  buildNoteRow,
  nextPosition,
  noteWrites,
  placeRow,
  readFolderId,
  readId,
  readNoteContent,
  readNotePatch,
  readParentNoteId,
  readProjectId,
  readStoredContent,
  sameContent,
  samePlace,
  sortNoteSummaries,
  splitTitle,
  toFullNote,
  toNoteContent,
  toNoteSummary,
  trashWrites,
  type NoteRow,
  type StoredNote,
  type TrashedNote,
} from "./noteContent";
import { planVersionWrites, versionWrites } from "./noteHistory";
import { PROJECTS_ID, projectsWrite } from "./projects";
import { listRecords, readRecord } from "./records";
import { scanNoteRows, toSearchResult } from "./search";
import {
  readBackupRecords,
  replaceRecordsWrites,
  streamBackupRecords,
  type BackupRecord,
  type StoreRecords,
} from "./snapshots";
import { StoreError, invalidRequest, noteNotFound } from "./storeError";
import { applyRemoteChange, type RemoteApplyStore } from "./sync/applyRemote";
import { syncKey, type SyncChange, type SyncChangeRef, type SyncDocKey } from "./sync/syncDocs";
import { allSyncKeys, readUnpublishedChanges } from "./sync/publishChanges";
import { SyncLedger } from "./sync/syncLedger";

const BACKLINK_LIMIT = 100;
const REMOTE_CHANGES_PER_TURN = 25;

/**
 * Who asked for a write. `external` writes come from outside this computer's
 * window (an AI client, another computer), so the window must be told of them.
 */
type WriteOptions = { external?: boolean };

/** A change to the library and whether it came from outside the window. */
export type StoreChange = NotesChange & { external: boolean };

/** The sync keys of the folders or projects a layout adds, changes or removes. */
const changedGroups = <T extends { id: string }>(
  kind: "folder" | "project",
  stored: readonly T[],
  saved: readonly T[],
) => {
  const previous = new Map(stored.map((group) => [group.id, group]));
  const keys = saved
    .filter((group) => stableJsonStringify(previous.get(group.id)) !== stableJsonStringify(group))
    .map((group) => syncKey(kind, group.id));
  const kept = new Set(saved.map((group) => group.id));
  for (const { id } of stored) if (!kept.has(id)) keys.push(syncKey(kind, id));
  return keys;
};

const noChange = (): NotesChange => ({
  changedNoteIds: [],
  deletedNoteIds: [],
  layoutChanged: false,
  conflicts: [],
});

export type NotesStoreOptions = {
  adapter: StorageAdapter;
  now?: () => number;
  createId?: () => string;
};

/**
 * Notes, folders, links, search and version history on top of any
 * StorageAdapter. The app's main process is its only writer, and calls run
 * one at a time, so each sees the previous one's result.
 */
export class NotesStore {
  private adapter: StorageAdapter;
  private readonly now: () => number;
  private readonly createId: () => string;
  private tail: Promise<unknown> = Promise.resolve();
  /** Every note row: the list, search, backlinks and placement all read the whole set. */
  private rows: Map<string, NoteRow> | null = null;
  /** Where each document stands for sync. */
  private readonly ledger: SyncLedger;

  private readonly publishListeners = new Set<() => void>();
  private readonly changeListeners = new Set<(change: StoreChange) => void>();
  /** Notes whose current content came from another device or an AI client. */
  private readonly remoteUpdatedAt = new Map<string, string>();
  /** Each row's text folded for search, built on first search; a saved row is a new object. */
  private readonly searchText = new WeakMap<NoteRow, string>();
  /** What applying changes from other devices uses of this store. */
  private readonly remote: RemoteApplyStore;

  /** Opens a store, upgrading data an older version wrote. */
  static async open(options: NotesStoreOptions) {
    await migrateStore(options.adapter);
    const now = options.now ?? (() => Date.now());
    return new NotesStore(options, now, await SyncLedger.load(options.adapter, now));
  }

  private constructor(options: NotesStoreOptions, now: () => number, ledger: SyncLedger) {
    this.adapter = options.adapter;
    this.now = now;
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.ledger = ledger;
    this.remote = {
      ledger,
      now,
      findNote: (noteId) => this.findNote(noteId),
      readRows: () => this.readRows(),
      readFolders: () => this.readFolders(),
      readProjects: () => this.readProjects(),
      keepVersion: (writes, noteId, previous, force) =>
        this.keepVersion(writes, noteId, previous, force),
      keepConflict: (writes, noteId, loser) => this.keepConflict(writes, noteId, loser),
      commit: (writes, changed) => this.commit(writes, changed),
      markRemote: (noteId, updatedAt) => void this.remoteUpdatedAt.set(noteId, updatedAt),
    };
  }

  /** Every sync record, for the calls sync makes; saves read only the ones they touch. */
  private async loadSyncRecords() {
    await this.ledger.loadAll();
    return this.ledger;
  }

  get adapterName() {
    return this.adapter.name;
  }

  /** This computer's id in the library, which also marks the files a note links to here. */
  get deviceId() {
    return this.ledger.device;
  }

  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async readRows() {
    if (!this.rows) {
      const records = await listRecords(this.adapter, "notes");
      this.rows = new Map(records.map((record) => [record.id, record.value]));
    }
    return this.rows;
  }

  private async readFolders() {
    return (await readRecord(this.adapter, "library", FOLDERS_ID))?.folders ?? [];
  }

  private async readProjects() {
    return (await readRecord(this.adapter, "library", PROJECTS_ID))?.projects ?? [];
  }

  private async findNote(noteId: string): Promise<StoredNote | null> {
    const row = (await this.readRows()).get(noteId);
    const content = row ? await readRecord(this.adapter, "documents", noteId) : null;
    return row && content ? { row, content } : null;
  }

  private async readNote(noteId: string) {
    const note = await this.findNote(noteId);
    if (!note) throw noteNotFound();
    return note;
  }

  /**
   * Writes everything or nothing, and keeps the caches in step. `changed`
   * names what changed on this device, so it is queued for sync in the same
   * commit; `change` is what the library's listeners are told.
   */
  private async commit(
    writes: StorageWrite[],
    changed: readonly SyncDocKey[] = [],
    change?: StoreChange,
    overridden?: ReadonlyMap<SyncDocKey, string>,
  ) {
    writes.push(...(await this.ledger.recordLocal(changed, overridden)));
    await this.adapter.commit(writes);
    this.ledger.afterCommit(writes);
    const rows = this.rows;
    if (rows)
      for (const write of writes) {
        if (write.collection !== "notes") continue;
        if (write.type === "delete") rows.delete(write.id);
        else rows.set(write.id, write.value as NoteRow);
      }
    if (changed.length > 0) for (const listener of this.publishListeners) listener();
    if (change) this.emit(change);
  }

  /** Commits writes that only change where documents stand for sync. */
  private async commitSyncState(writes: StorageWrite[]) {
    if (writes.length === 0) return;
    await this.adapter.commit(writes);
    this.ledger.afterCommit(writes);
  }

  private emit(change: StoreChange) {
    const { changedNoteIds, deletedNoteIds, layoutChanged, conflicts } = change;
    if (changedNoteIds.length || deletedNoteIds.length || layoutChanged || conflicts.length)
      for (const listener of this.changeListeners) listener(change);
  }

  /** Calls `listener` after each change made on this device that sync should publish. */
  onLocalChange(listener: () => void) {
    this.publishListeners.add(listener);
    return () => void this.publishListeners.delete(listener);
  }

  /** Calls `listener` with what each change did to the library; returns an unsubscribe. */
  onChange(listener: (change: StoreChange) => void) {
    this.changeListeners.add(listener);
    return () => void this.changeListeners.delete(listener);
  }

  /** Adds writes that keep `previous` as a version of the note, if the history rules say so. */
  private async keepVersion(
    writes: StorageWrite[],
    noteId: string,
    previous: StoredNote,
    force: boolean,
  ) {
    const index = await readRecord(this.adapter, "history", noteId);
    writes.push(
      ...versionWrites(noteId, {
        index,
        document: toNoteContent(previous.row, previous.content),
        savedAt: Date.parse(previous.row.updatedAt),
        now: this.now(),
        force,
        createId: this.createId,
      }),
    );
  }

  /**
   * Adds writes that keep `loser`, the version of a note that lost a conflict, in its history
   * for good, and returns the conflict. Null when that content is kept that way already.
   */
  private async keepConflict(
    writes: StorageWrite[],
    noteId: string,
    loser: { content: NoteContent; updatedAt: string },
  ): Promise<NoteConflict | null> {
    const planned = planVersionWrites(noteId, {
      index: await readRecord(this.adapter, "history", noteId),
      document: loser.content,
      savedAt: Date.parse(loser.updatedAt),
      now: this.now(),
      force: true,
      conflict: true,
      createId: this.createId,
    });
    if (!planned) return null;
    writes.push(...planned.writes);
    return { noteId, versionId: planned.versionId, title: loser.content.title };
  }

  private updatedAt(previous?: string) {
    // Distinct versions even when two serialized edits share a millisecond.
    return new Date(Math.max(this.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
  }

  // ------------------------------------------------------------------- writes

  /**
   * Adds notes, each at the end of its folder, of the note it goes inside, or
   * of its project's or the library's top level, in one commit. Ids come from
   * the caller and must be new.
   */
  createNotes(
    inputs: readonly unknown[],
    { external = false }: WriteOptions = {},
  ): Promise<NoteDocument[]> {
    return this.serialize(async () => {
      const [rows, folders, projects] = await Promise.all([
        this.readRows(),
        this.readFolders(),
        this.readProjects(),
      ]);
      const folderIds = new Set(folders.map((folder) => folder.id));
      const projectIds = new Set(projects.map((project) => project.id));
      const placed = [...rows.values()];
      const writes: StorageWrite[] = [];
      const changed: SyncDocKey[] = [];
      const created: NoteDocument[] = [];
      const updatedAt = this.updatedAt();
      for (const input of inputs) {
        if (!isRecord(input)) throw invalidRequest("note");
        const id = readId(input.id, "note");
        if (rows.has(id) || created.some((note) => note.id === id))
          throw invalidRequest("a note with that id already exists");
        const folderId = readFolderId(input.folderId);
        if (folderId && !folderIds.has(folderId)) throw invalidRequest("unknown folder");
        const parentNoteId = (!folderId && readParentNoteId(input.parentNoteId)) || undefined;
        if (parentNoteId && !rows.has(parentNoteId) && !created.some((n) => n.id === parentNoteId))
          throw invalidRequest("unknown note");
        // A folder or a parent note decides the note's project.
        const projectId = folderId || parentNoteId ? undefined : readProjectId(input.projectId);
        if (projectId && !projectIds.has(projectId)) throw invalidRequest("unknown project");
        const note = readNoteContent(input);
        const place = { folderId, projectId, parentNoteId };
        const position = nextPosition(placed, place);
        const row = buildNoteRow(id, note, { ...place, position }, updatedAt);
        placed.push(row);
        writes.push(...noteWrites(row, note));
        changed.push(syncKey("note", id), syncKey("place", id));
        created.push(toFullNote(row, splitTitle(note).content));
      }
      await this.commit(writes, changed, {
        ...noChange(),
        changedNoteIds: created.map((note) => note.id),
        layoutChanged: true,
        external,
      });
      return created;
    });
  }

  async createNote(input: unknown, options: WriteOptions = {}): Promise<NoteDocument> {
    const [note] = await this.createNotes([input], options);
    return note!;
  }

  /**
   * Saves the fields `patch` names and keeps the rest. A title-only save
   * touches just the note's row.
   *
   * `baseUpdatedAt` is the version the edit was made to. User edits against an
   * older sync or AI version keep that version in the note's history as a
   * conflict. External
   * clients must supply the current version; their stale writes are rejected.
   */
  saveNote(
    noteId: string,
    patchInput: unknown,
    baseUpdatedAt?: string,
    options: WriteOptions = {},
  ): Promise<SavedNote> {
    return this.serialize(async () => {
      const previous = await this.readNote(noteId);
      const patch = readNotePatch(patchInput, previous.content.filesByTab);
      // AI updates compare within the serialized write, so concurrent UI saves cannot slip through.
      if (options.external && (!baseUpdatedAt || baseUpdatedAt !== previous.row.updatedAt))
        throw new StoreError(
          "This note changed. Read it again before applying this edit.",
          "CONFLICT",
          409,
        );
      if (Object.keys(patch).length === 0) return { updatedAt: previous.row.updatedAt };
      const current = toNoteContent(previous.row, previous.content);
      const next = applyNotePatch(current, patch);
      // Editors often hand back what is already stored. Saving that would
      // still count as an edit, which sync would see as a conflict.
      if (sameContent(current, next)) return { updatedAt: previous.row.updatedAt };
      const updatedAt = this.updatedAt(previous.row.updatedAt);
      const row = buildNoteRow(noteId, next, previous.row, updatedAt);
      const writes: StorageWrite[] = [];
      const changed: SyncDocKey[] = [syncKey("note", noteId)];
      // Sync and AI writes set this, so a user edit made to older content keeps both versions.
      const synced = this.remoteUpdatedAt.get(noteId);
      const conflict =
        baseUpdatedAt && synced === previous.row.updatedAt && baseUpdatedAt !== synced
          ? await this.keepConflict(writes, noteId, {
              content: current,
              updatedAt: previous.row.updatedAt,
            })
          : null;
      // A conflict keeps the replaced content already; two plans would overwrite one index.
      if (!conflict) await this.keepVersion(writes, noteId, previous, false);
      if (Object.keys(patch).some((key) => key !== "title")) writes.push(...noteWrites(row, next));
      else writes.push({ type: "put", collection: "notes", id: noteId, value: row });
      // The device that wrote the version this edit replaced learns that its edit lost.
      const heldClock = conflict && (await this.ledger.read(syncKey("note", noteId)))?.clock;
      await this.commit(
        writes,
        changed,
        {
          ...noChange(),
          changedNoteIds: [noteId],
          conflicts: conflict ? [conflict] : [],
          external: Boolean(options.external),
        },
        heldClock ? new Map([[syncKey("note", noteId), heldClock]]) : undefined,
      );
      if (options.external) this.remoteUpdatedAt.set(noteId, updatedAt);
      else this.remoteUpdatedAt.delete(noteId);
      return conflict ? { updatedAt, conflict } : { updatedAt };
    });
  }

  /**
   * Moves a note to persistent Trash and keeps its version history. Its
   * sub-notes stay, as normal notes at the end of the place it was in.
   */
  deleteNote(noteId: string, { external = false }: WriteOptions = {}): Promise<NoteDocument> {
    return this.serialize(async () => {
      const previous = await this.readNote(noteId);
      const rows = await this.readRows();
      const writes: StorageWrite[] = [];
      const changed: SyncDocKey[] = [syncKey("note", noteId)];
      await this.keepVersion(writes, noteId, previous, true);
      const children = [...rows.values()]
        .filter((row) => !row.folderId && row.parentNoteId === noteId)
        .sort((left, right) => left.position - right.position);
      let position = nextPosition(rows.values(), previous.row);
      for (const child of children) {
        const value = placeRow(child, { ...previous.row, position: position++ });
        writes.push({ type: "put", collection: "notes", id: child.id, value });
        changed.push(syncKey("place", child.id));
      }
      writes.push(...trashWrites(previous, this.now()));
      await this.commit(writes, changed, {
        ...noChange(),
        deletedNoteIds: [noteId],
        layoutChanged: true,
        external,
      });
      return toFullNote(previous.row, previous.content);
    });
  }

  /**
   * Puts a deleted note back where it was (undo), moving later siblings down.
   * A note whose folder, project or parent note is gone goes to the library's
   * top level.
   */
  restoreNote(input: unknown, options: WriteOptions = {}): Promise<NoteDocument> {
    return this.serialize(() => this.restoreNoteContent(input, options));
  }

  private async restoreNoteContent(
    input: unknown,
    { external = false }: WriteOptions,
  ): Promise<NoteDocument> {
    if (!isRecord(input)) throw invalidRequest("note");
    const id = readId(input.id, "note");
    const [rows, folders, projects] = await Promise.all([
      this.readRows(),
      this.readFolders(),
      this.readProjects(),
    ]);
    if (rows.has(id)) throw invalidRequest("that note exists");
    const requested = readFolderId(input.folderId);
    const folderId =
      requested && folders.some((folder) => folder.id === requested) ? requested : null;
    const requestedParent = requested ? undefined : readParentNoteId(input.parentNoteId);
    const parentNoteId = requestedParent && rows.has(requestedParent) ? requestedParent : undefined;
    // Only a note outside folders and other notes has a project of its own.
    const requestedProject = requested || parentNoteId ? undefined : readProjectId(input.projectId);
    const project = projects.find((entry) => entry.id === requestedProject);
    const place = { folderId, projectId: project?.id, parentNoteId };
    const end = nextPosition(rows.values(), place);
    const position =
      typeof input.position === "number" && Number.isInteger(input.position)
        ? Math.min(Math.max(input.position, 0), end)
        : end;
    const note = readNoteContent(input);
    const writes: StorageWrite[] = [];
    const changed: SyncDocKey[] = [syncKey("note", id), syncKey("place", id)];
    for (const row of rows.values())
      if (samePlace(row, place) && row.position >= position) {
        writes.push({
          type: "put",
          collection: "notes",
          id: row.id,
          value: { ...row, position: row.position + 1 },
        });
        changed.push(syncKey("place", row.id));
      }
    const row = buildNoteRow(id, note, { ...place, position }, this.updatedAt());
    writes.push(...noteWrites(row, note));
    await this.commit(writes, changed, {
      ...noChange(),
      changedNoteIds: [id],
      layoutChanged: true,
      external,
    });
    return toFullNote(row, splitTitle(note).content);
  }

  private async readTrashedNote(noteId: string): Promise<TrashedNote | null> {
    if ((await this.readRows()).has(noteId)) return null;
    return readRecord(this.adapter, "trash", noteId);
  }

  getTrash(): Promise<NoteTrashEntry[]> {
    return this.serialize(async () => {
      const [rows, records] = await Promise.all([
        this.readRows(),
        listRecords(this.adapter, "trash"),
      ]);
      return records
        .filter((record) => !rows.has(record.id))
        .map(({ id, value }) => ({ id, title: value.note.title, deletedAt: value.deletedAt }))
        .sort((a, b) => b.deletedAt - a.deletedAt || a.id.localeCompare(b.id));
    });
  }

  restoreTrashedNote(noteId: string, options: WriteOptions = {}): Promise<NoteDocument> {
    return this.serialize(async () => {
      const trashed = await this.readTrashedNote(readId(noteId, "note"));
      if (!trashed) throw noteNotFound();
      return this.restoreNoteContent(trashed.note, options);
    });
  }

  /** Removes the recoverable content; the sync tombstone still prevents resurrection. */
  deleteTrashedNote(noteId: string): Promise<void> {
    return this.serialize(async () => {
      readId(noteId, "note");
      if ((await this.readRows()).has(noteId)) throw invalidRequest("that note is not in Trash");
      if (!(await this.readTrashedNote(noteId))) throw noteNotFound();
      const history = await readRecord(this.adapter, "history", noteId);
      await this.commit([
        { type: "delete", collection: "trash", id: noteId },
        { type: "delete", collection: "history", id: noteId },
        ...(history?.versions ?? []).map((version): StorageWrite => ({
          type: "delete",
          collection: "revisions",
          id: version.id,
        })),
      ]);
    });
  }

  /**
   * Saves every project and folder, and the order of the notes in each place.
   * Notes left out keep their place unless their folder or project is gone:
   * then they move to the top level of the folder's project, or of the
   * library. A removed project's folders move to the library's top level.
   */
  saveLayout(input: unknown, { external = false }: WriteOptions = {}): Promise<NotesBootstrap> {
    return this.serialize(async () => {
      const [rows, storedFolders, storedProjects] = await Promise.all([
        this.readRows(),
        this.readFolders(),
        this.readProjects(),
      ]);
      const { projects, folders, placements, unlistedPlace } = readLayout(input, {
        projects: storedProjects,
        folders: storedFolders,
        rows,
      });
      const next = arrangeNotes(rows, placements, unlistedPlace);
      const writes: StorageWrite[] = [foldersWrite(folders), projectsWrite(projects)];
      const changed: SyncDocKey[] = [
        ...changedGroups("project", storedProjects, projects),
        ...changedGroups("folder", storedFolders, folders),
      ];
      for (const row of next.values()) {
        const previous = rows.get(row.id)!;
        if (!samePlace(previous, row) || previous.position !== row.position) {
          writes.push({ type: "put", collection: "notes", id: row.id, value: row });
          changed.push(syncKey("place", row.id));
        }
      }
      await this.commit(writes, changed, { ...noChange(), layoutChanged: true, external });
      return {
        projects,
        folders,
        notes: sortNoteSummaries([...next.values()].map(toNoteSummary)),
      };
    });
  }

  // -------------------------------------------------------------------- reads

  getLibrary(): Promise<NotesBootstrap> {
    return this.serialize(async () => {
      const [projects, storedFolders, rows] = await Promise.all([
        this.readProjects(),
        this.readFolders(),
        this.readRows(),
      ]);
      // A folder or note filed into a project, folder or note another device
      // deleted shows at the top level, and so do notes two devices nested
      // inside each other.
      const projectIds = new Set(projects.map((project) => project.id));
      const known = (projectId: string | undefined) =>
        projectId && projectIds.has(projectId) ? projectId : undefined;
      const folders = storedFolders.map((folder) =>
        toFolder(folder.id, { ...folder, projectId: known(folder.projectId) }),
      );
      const folderIds = new Set(folders.map((folder) => folder.id));
      const parents = resolveNoteParents(rows.values());
      const notes = [...rows.values()].map((row) => {
        if (row.folderId && folderIds.has(row.folderId)) return placeRow(row, row);
        if (parents.has(row.id)) return row;
        return placeRow(row, {
          folderId: null,
          projectId: known(row.projectId),
          position: row.position,
        });
      });
      return { projects, folders, notes: sortNoteSummaries(notes.map(toNoteSummary)) };
    });
  }

  getNote(noteId: string): Promise<NoteDocument> {
    return this.serialize(async () => {
      const { row, content } = await this.readNote(noteId);
      return toFullNote(row, content);
    });
  }

  /** The other notes whose bodies link to this one, newest first. */
  getBacklinks(noteId: string): Promise<NoteBacklinks> {
    return this.serialize(async () => {
      const target = noteId.toLowerCase();
      const linking = [...(await this.readRows()).values()]
        .filter((row) => row.id !== noteId && row.linkedNoteIds.includes(target))
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
        );
      return {
        notes: linking.slice(0, BACKLINK_LIMIT).map(({ id, title, updatedAt }) => ({
          id,
          title,
          updatedAt,
        })),
        noteCount: linking.length,
      };
    });
  }

  searchNotes(query: string, limit = 20, offset = 0): Promise<NoteContentSearchResponse> {
    return this.serialize(async () => {
      const trimmed = query.trim();
      if (!trimmed) return { results: [], hasMore: false };
      const rows = await this.readRows();
      let matches: NoteRow[];
      if (this.adapter.searchNotes) {
        const hits = await this.adapter.searchNotes(trimmed, limit + 1, offset);
        matches = hits.flatMap((hit) => rows.get(hit.id) ?? []);
      } else
        matches = scanNoteRows(rows.values(), trimmed, this.searchText).slice(
          offset,
          offset + limit + 1,
        );
      return {
        results: await Promise.all(
          matches.slice(0, limit).map(async (row) => {
            const content = await readRecord(this.adapter, "documents", row.id);
            return toSearchResult(row, trimmed, content && toNoteContent(row, content));
          }),
        ),
        hasMore: matches.length > limit,
      };
    });
  }

  // ------------------------------------------------------------------ history

  /** A note's saved versions, newest first; the note's current content is not one of them. */
  getNoteHistory(noteId: string): Promise<NoteHistory> {
    return this.serialize(async () => {
      const history = await readRecord(this.adapter, "history", noteId);
      return {
        versions: (history?.versions ?? []).map(({ id, savedAt, title, sizeBytes, conflict }) => ({
          id,
          savedAt,
          title,
          sizeBytes,
          ...(conflict && { conflict }),
        })),
      };
    });
  }

  /** One saved version's full content, for previewing it. */
  getNoteVersion(noteId: string, versionId: string): Promise<NoteVersion> {
    return this.serialize(async () => {
      const revision = await this.readRevision(noteId, versionId);
      return { savedAt: revision.savedAt, note: readStoredContent(revision.document) };
    });
  }

  /**
   * Makes a saved version the note's content again. The content it replaces
   * is kept as a version first, so a restore can be undone.
   */
  restoreNoteVersion(noteId: string, versionId: string, options: WriteOptions = {}): Promise<void> {
    return this.serialize(async () => {
      const revision = await this.readRevision(noteId, versionId);
      const previous = await this.readNote(noteId);
      const restored = readNoteContent(revision.document);
      const updatedAt = this.updatedAt(previous.row.updatedAt);
      const writes: StorageWrite[] = [];
      await this.keepVersion(writes, noteId, previous, true);
      writes.push(...noteWrites(buildNoteRow(noteId, restored, previous.row, updatedAt), restored));
      await this.commit(writes, [syncKey("note", noteId)], {
        ...noChange(),
        changedNoteIds: [noteId],
        external: Boolean(options.external),
      });
      if (options.external) this.remoteUpdatedAt.set(noteId, updatedAt);
    });
  }

  private async readRevision(noteId: string, versionId: string) {
    const revision = await readRecord(this.adapter, "revisions", versionId);
    if (!revision || revision.noteId !== noteId)
      throw new StoreError("That version no longer exists.", "NOT_FOUND", 404);
    return revision;
  }

  // ------------------------------------------------------------------ backups

  /** Every record a backup holds, read between saves so a backup is consistent. */
  readAllRecords(): Promise<StoreRecords> {
    return this.serialize(() => readBackupRecords(this.adapter));
  }

  /**
   * Every record as stored JSON, for backups. Streams from the backend's
   * consistent snapshot when it has one, so saves never wait on a backup;
   * otherwise reads everything between two saves.
   */
  async *streamAllRecords(): AsyncIterable<StorageSnapshotRecord> {
    yield* streamBackupRecords(this.adapter, () => this.readAllRecords());
  }

  /**
   * Makes the store hold exactly `records` (a restore), in one commit between
   * saves. The app restarts afterwards, which upgrades records an older
   * version wrote. The restored notes are published again on the next sync,
   * so other devices get them too.
   */
  replaceAllRecords(records: Partial<Record<StorageCollection, readonly BackupRecord[]>>) {
    return this.serialize(async () => {
      const writes: StorageWrite[] = [this.ledger.requestRepublish()];
      writes.push(...(await replaceRecordsWrites(this.adapter, records)));
      this.rows = null;
      await this.commit(writes);
    });
  }

  // --------------------------------------------------------------------- sync

  /** This device's id in a sync library. */
  readSyncDevice(): Promise<string> {
    return this.serialize(async () => this.ledger.device);
  }

  /**
   * Gets ready to sync with a library. A library this store has not published
   * to (a new sync folder), or a restore since the last sync, gets every
   * project, folder, note and deletion this store knows published again.
   */
  prepareSync(libraryId: string): Promise<void> {
    return this.serialize(async () => {
      const ledger = await this.loadSyncRecords();
      if (ledger.libraryId === libraryId && !ledger.needsRepublish) return;
      await this.commitSyncState(await ledger.republish(await allSyncKeys(this.remote), libraryId));
    });
  }

  /** How many changes made here wait to be published. */
  countUnpublishedChanges(): Promise<number> {
    return this.serialize(async () => (await this.loadSyncRecords()).unpublished().length);
  }

  /** The current version of up to `limit` documents changed here and not yet published. */
  readUnpublishedChanges(limit: number): Promise<SyncChange[]> {
    return this.serialize(async () => {
      await this.loadSyncRecords();
      return readUnpublishedChanges(this.remote, limit);
    });
  }

  /** Records that these versions are published; ones changed since stay queued. */
  markChangesPublished(published: readonly SyncChangeRef[]): Promise<void> {
    return this.serialize(async () =>
      this.commitSyncState((await this.loadSyncRecords()).markPublished(published)),
    );
  }

  /** The changes, named by their files, that hold something this store doesn't have yet. */
  selectMissingChanges<T extends SyncChangeRef>(refs: readonly T[]): Promise<T[]> {
    return this.serialize(async () => {
      const ledger = await this.loadSyncRecords();
      return refs.filter((ref) => !ledger.holds(ref));
    });
  }

  /**
   * Applies changes from other devices, in order. Each is one commit, and
   * other requests run between batches, so a large first sync never holds up saves.
   */
  async applyRemoteChanges(changes: readonly SyncChange[]): Promise<NotesChange> {
    const result = noChange();
    for (let start = 0; start < changes.length; start += REMOTE_CHANGES_PER_TURN) {
      const batch = changes.slice(start, start + REMOTE_CHANGES_PER_TURN);
      await this.serialize(async () => {
        await this.loadSyncRecords();
        for (const change of batch) await applyRemoteChange(this.remote, change, result);
      });
    }
    this.emit({ ...result, external: true });
    return result;
  }

  /** Publishes every document again on the next sync (its files there couldn't be resealed). */
  requestRepublish(): Promise<void> {
    return this.serialize(() => this.commitSyncState([this.ledger.requestRepublish()]));
  }

  /**
   * Runs `replace` between requests and carries on with the adapter it
   * returns, which holds the same records in another form (encryption turned
   * on or off). Requests made meanwhile wait.
   */
  replaceAdapter(replace: () => Promise<StorageAdapter>): Promise<void> {
    return this.serialize(async () => {
      this.adapter = await replace();
      this.ledger.useAdapter(this.adapter);
    });
  }

  close() {
    return this.serialize(async () => {
      await this.adapter.close?.();
    });
  }
}

/**
 * The contract a storage backend implements. Loam ships SQLite (default)
 * and in-memory adapters; anything that can store JSON records and apply a
 * batch of writes atomically can be plugged in.
 *
 * Adapters only store records. Note rows, links, search text, placement and
 * version history all live in `NotesStore`, so every backend behaves the same.
 */

/**
 * Record groups the store reads and writes. Adapters may map each to a table.
 * `notes` holds a small row per note (title, place, links, search text) and
 * `documents` its content, so listing the library never reads note bodies.
 * `history` holds each note's index of saved versions and `revisions` the
 * versions themselves. `sync` holds where each note stands for sync.
 */
export type StorageCollection =
  "notes" | "documents" | "library" | "history" | "revisions" | "trash" | "meta" | "sync";

export const STORAGE_COLLECTIONS: readonly StorageCollection[] = [
  "notes",
  "documents",
  "library",
  "history",
  "revisions",
  "trash",
  "meta",
  "sync",
];

export type StoredRecord<T = unknown> = { id: string; value: T };

/**
 * One write of a commit. The store writes only its own collections; an
 * adapter stores any collection name it is given (upgrades remove ones older
 * versions used).
 */
export type StorageWrite<Collection extends string = StorageCollection> =
  | { type: "put"; collection: Collection; id: string; value: unknown }
  | { type: "delete"; collection: Collection; id: string };

/** Searchable text the store writes into each `notes` record value. */
export type StorageNoteSearchFields = {
  title: string;
  text: string;
};

export type StorageSearchHit = { id: string };

export type StorageSnapshotRecord = {
  collection: string;
  id: string;
  /** The record's value as JSON text. */
  json: string;
};

/** Values come back as stored: the store checks or trusts them, not the adapter. */
export interface StorageAdapter {
  /** Shown in diagnostics, e.g. "sqlite" or "memory". */
  readonly name: string;
  get(collection: string, id: string): Promise<StoredRecord | null>;
  list(collection: string): Promise<StoredRecord[]>;
  /** Applies every write or none; throws if they could not be applied. */
  commit(writes: readonly StorageWrite<string>[]): Promise<void>;
  /**
   * Optional full-text search over `notes` records (see StorageNoteSearchFields).
   * Without it the store falls back to a substring scan.
   */
  searchNotes?(query: string, limit: number, offset?: number): Promise<StorageSearchHit[]>;
  /**
   * Optional: every record as its stored JSON text, all from one point in
   * time, while saves carry on. Backups use it to stream a large library
   * without parsing it or pausing saves; without it they read every record
   * between two saves instead.
   */
  readSnapshot?(): AsyncIterable<StorageSnapshotRecord>;
  /** Optional: gives back space freed by deleting many records (after an upgrade). */
  compact?(): Promise<void>;
  close?(): Promise<void>;
}

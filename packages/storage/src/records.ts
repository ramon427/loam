import type { StorageAdapter, StoredRecord } from "./adapter";
import type { FoldersRecord } from "./folders";
import type { NoteRow, StoredContent, TrashedNote } from "./noteContent";
import type { HistoryIndex, RevisionRecord } from "./noteHistory";
import type { ProjectsRecord } from "./projects";

/** What the store keeps in each collection of notes (`meta` and `sync` have their own readers). */
type StoreValues = {
  notes: NoteRow;
  documents: StoredContent;
  /** One record holds every folder, another every project. */
  library: Partial<FoldersRecord & ProjectsRecord>;
  history: HistoryIndex;
  revisions: RevisionRecord;
  trash: TrashedNote;
};

type StoreCollection = keyof StoreValues;

/*
 * These records are written by the store, or restored from one of its
 * backups, and upgraded when it opens (see migrations), so their shape is
 * trusted here. Note content is checked when it is written and read
 * leniently where it is shown.
 */

export const readRecord = async <C extends StoreCollection>(
  adapter: StorageAdapter,
  collection: C,
  id: string,
) => ((await adapter.get(collection, id))?.value ?? null) as StoreValues[C] | null;

export const listRecords = async <C extends StoreCollection>(
  adapter: StorageAdapter,
  collection: C,
) => (await adapter.list(collection)) as StoredRecord<StoreValues[C]>[];

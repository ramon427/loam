import {
  STORAGE_COLLECTIONS,
  type StorageAdapter,
  type StorageCollection,
  type StorageSnapshotRecord,
  type StorageWrite,
  type StoredRecord,
} from "./adapter";

/** Backups hold the notes; where each stands for sync belongs to this device. */
export const BACKUP_COLLECTIONS = STORAGE_COLLECTIONS.filter((collection) => collection !== "sync");

/** A record as a backup keeps it: versions are the store's own and are not restored. */
export type BackupRecord = { id: string; value: unknown };

export type StoreRecords = Record<Exclude<StorageCollection, "sync">, StoredRecord[]>;

/** Every record a backup holds. */
export const readBackupRecords = async (adapter: StorageAdapter): Promise<StoreRecords> => {
  const entries = await Promise.all(
    BACKUP_COLLECTIONS.map(
      async (collection) => [collection, await adapter.list(collection)] as const,
    ),
  );
  return Object.fromEntries(entries) as StoreRecords;
};

/**
 * Every record a backup holds, as stored JSON: from the backend's consistent
 * snapshot when it has one, otherwise from `readAll`.
 */
export async function* streamBackupRecords(
  adapter: StorageAdapter,
  readAll: () => Promise<StoreRecords>,
): AsyncIterable<StorageSnapshotRecord> {
  if (adapter.readSnapshot) {
    for await (const record of adapter.readSnapshot())
      if (record.collection !== "sync") yield record;
    return;
  }
  const records = await readAll();
  for (const collection of BACKUP_COLLECTIONS)
    for (const record of records[collection])
      yield { collection, id: record.id, json: JSON.stringify(record.value) };
}

/** The writes that make the backed-up collections hold exactly `records`. */
export const replaceRecordsWrites = async (
  adapter: StorageAdapter,
  records: Partial<Record<StorageCollection, readonly BackupRecord[]>>,
) => {
  const writes: StorageWrite[] = [];
  for (const collection of BACKUP_COLLECTIONS) {
    const incoming = records[collection] ?? [];
    const keep = new Set(incoming.map((record) => record.id));
    for (const existing of await adapter.list(collection)) {
      if (!keep.has(existing.id)) writes.push({ type: "delete", collection, id: existing.id });
    }
    for (const record of incoming)
      writes.push({ type: "put", collection, id: record.id, value: record.value });
  }
  return writes;
};

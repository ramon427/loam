import {
  STORAGE_COLLECTIONS,
  type StorageAdapter,
  type StorageWrite,
  type StoredRecord,
} from "../adapter";
import { StoreError } from "../storeError";
import { isSealedValue, openValue, SealError, sealValue, type DataKey } from "./seal";

/** Binds a sealed record to its place, so records can't be swapped or moved. */
export const recordContext = (collection: string, id: string) =>
  `loam-record:${collection}\u0000${id}`;

const damaged = (collection: string, id: string, cause?: unknown) =>
  new StoreError(
    `Some of your notes could not be decrypted (${collection} ${id}). They may be damaged; restore a backup.`,
    "DECRYPT_FAILED",
    500,
    { cause },
  );

/**
 * Seals every record's value with `key` before it reaches `inner`, and opens
 * it on the way back. Ids and the number of records stay visible to the
 * backend; everything in a value doesn't. A value that isn't sealed with
 * `key`, or was changed, is an error rather than being read as is.
 *
 * There is no `searchNotes`, so the backend's own text index never sees a
 * note; the store searches its in-memory rows instead. `readSnapshot` passes
 * the sealed values through, so backups stay encrypted.
 */
export function encryptStorageAdapter(inner: StorageAdapter, key: DataKey): StorageAdapter {
  const open = (collection: string, record: StoredRecord): StoredRecord => {
    if (!isSealedValue(record.value) || record.value.loamSealed !== key.id)
      throw damaged(collection, record.id);
    try {
      return {
        id: record.id,
        value: openValue([key], record.value, recordContext(collection, record.id)),
      };
    } catch (error) {
      throw damaged(collection, record.id, error);
    }
  };
  return {
    name: inner.name,
    async get(collection: string, id: string) {
      const record = await inner.get(collection, id);
      return record ? open(collection, record) : null;
    },
    async list(collection: string) {
      return (await inner.list(collection)).map((record) => open(collection, record));
    },
    async commit(writes: readonly StorageWrite<string>[]) {
      return inner.commit(
        writes.map((write) =>
          write.type === "put"
            ? {
                ...write,
                value: sealValue(key, write.value, recordContext(write.collection, write.id)),
              }
            : write,
        ),
      );
    },
    ...(inner.readSnapshot ? { readSnapshot: () => inner.readSnapshot!() } : {}),
    ...(inner.compact ? { compact: () => inner.compact!() } : {}),
    ...(inner.close ? { close: () => inner.close!() } : {}),
  };
}

/** The adapter the store uses: `inner` itself while encryption is off. */
export const withEncryption = (inner: StorageAdapter, key: DataKey | null) =>
  key ? encryptStorageAdapter(inner, key) : inner;

const CONVERT_BATCH = 200;

/**
 * Re-stores every record of `inner` sealed with `to`, or plain when `to` is
 * null. Records are opened with `from` (or read plain). Records already in
 * their final form are skipped, so a conversion stopped part way (a crash)
 * finishes when run again. Each batch is one commit.
 */
export async function convertStoredRecords(
  inner: StorageAdapter,
  { from, to }: { from: DataKey | null; to: DataKey | null },
) {
  const keys = [from, to];
  let converted = 0;
  for (const collection of STORAGE_COLLECTIONS) {
    let writes: StorageWrite[] = [];
    for (const record of await inner.list(collection)) {
      const sealed = isSealedValue(record.value) ? record.value : null;
      if (to ? sealed?.loamSealed === to.id : !sealed) continue;
      let value: unknown = record.value;
      if (sealed) {
        try {
          value = openValue(keys, sealed, recordContext(collection, record.id));
        } catch (error) {
          if (error instanceof SealError) throw damaged(collection, record.id, error);
          throw error;
        }
      }
      writes.push({
        type: "put",
        collection,
        id: record.id,
        value: to ? sealValue(to, value, recordContext(collection, record.id)) : value,
      });
      if (writes.length >= CONVERT_BATCH) {
        await inner.commit(writes);
        converted += writes.length;
        writes = [];
      }
    }
    if (writes.length > 0) await inner.commit(writes);
    converted += writes.length;
  }
  // Space the old records used may still hold their old form; give it back.
  await inner.compact?.();
  return converted;
}

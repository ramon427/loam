import type { StorageAdapter, StorageWrite, StoredRecord } from "../adapter";

/** Keeps records in process memory. Used by tests and as a reference adapter. */
export function createMemoryStorageAdapter(): StorageAdapter {
  const collections = new Map<string, Map<string, StoredRecord>>();
  const collection = (name: string) => {
    let records = collections.get(name);
    if (!records) {
      records = new Map();
      collections.set(name, records);
    }
    return records;
  };

  return {
    name: "memory",
    async get(name: string, id: string) {
      const record = collection(name).get(id);
      return record ? structuredClone(record) : null;
    },
    async list(name: string) {
      return [...collection(name).values()].map((record) => structuredClone(record));
    },
    async commit(writes: readonly StorageWrite<string>[]) {
      // Clone first, so a value that can't be stored leaves every record as it was.
      const values = writes.map((write) =>
        write.type === "put" ? structuredClone(write.value) : null,
      );
      writes.forEach((write, index) => {
        const records = collection(write.collection);
        if (write.type === "delete") records.delete(write.id);
        else records.set(write.id, { id: write.id, value: values[index] });
      });
    },
  };
}

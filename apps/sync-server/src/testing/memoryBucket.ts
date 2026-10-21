import type { SyncBucket } from "../worker";

/** An R2 bucket in memory, listing in key order a page at a time as R2 does. */
export const createMemoryBucket = () => {
  const files = new Map<string, Uint8Array>();
  const bucket: SyncBucket = {
    async get(key) {
      const bytes = files.get(key);
      if (!bytes) return null;
      return {
        body: new Response(bytes.slice()).body!,
        size: bytes.byteLength,
        text: async () => new TextDecoder().decode(bytes),
      };
    },
    async put(key, value) {
      files.set(key, new Uint8Array(await new Response(value).arrayBuffer()));
    },
    async delete(key) {
      files.delete(key);
    },
    async list({ prefix, cursor, limit = 1000 }) {
      const keys = [...files.keys()].filter((key) => key.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const end = start + limit;
      return {
        objects: keys.slice(start, end).map((key) => ({ key })),
        truncated: end < keys.length,
        ...(end < keys.length ? { cursor: String(end) } : {}),
      };
    },
  };
  return { bucket, files };
};

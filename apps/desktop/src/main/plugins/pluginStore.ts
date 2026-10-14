import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { isRecord } from "@loam/shared/utils/isRecord";
import { StoreError } from "@loam/storage/storeError";

const MAX_STORE_BYTES = 1024 * 1024;

/** Each plugin's own key-value storage: one JSON file per plugin in `folder`, up to 1 MB. */
export const createPluginStore = (folder: string) => {
  const storePath = (id: string) => join(folder, `${id}.json`);
  const readStore = async (id: string): Promise<Record<string, unknown>> => {
    try {
      const value: unknown = JSON.parse(await readFile(storePath(id), "utf8"));
      return isRecord(value) ? value : {};
    } catch {
      return {};
    }
  };

  return {
    async get(id: string, key: string) {
      return (await readStore(id))[key] ?? null;
    },

    /** Sets `key`; null or undefined removes it. */
    async set(id: string, key: string, value: unknown) {
      const next = { ...(await readStore(id)) };
      if (value === null || value === undefined) delete next[key];
      else next[key] = value;
      const json = JSON.stringify(next);
      if (Buffer.byteLength(json) > MAX_STORE_BYTES)
        throw new StoreError("The plugin's storage is over 1 MB.", "PLUGIN_TOO_LARGE", 413);
      await mkdir(folder, { recursive: true });
      const temporary = `${storePath(id)}.${randomUUID()}.tmp`;
      await writeFile(temporary, json);
      await rename(temporary, storePath(id));
    },
  };
};

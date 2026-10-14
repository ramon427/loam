import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import type { StorageAdapter } from "@loam/storage/adapter";
import { createSqliteStorageAdapter } from "@loam/storage/adapters/sqliteAdapter";

type StorageAdapterContext = {
  /** The folder Loam owns; adapters may keep local files here. */
  dataDirectory: string;
  /** Adapter-specific settings from `storage.json`. */
  options: Record<string, unknown>;
};

/**
 * Storage backends the app can open. To use your own database, implement
 * `StorageAdapter` from `@loam/storage`, register it here, and select it
 * in `<data directory>/storage.json`, for example `{ "adapter": "my-db" }`.
 */
const STORAGE_ADAPTERS: Record<string, (context: StorageAdapterContext) => StorageAdapter> = {
  sqlite: ({ dataDirectory }) => createSqliteStorageAdapter(join(dataDirectory, "notes.sqlite")),
};

/** `storage.json`: which adapter opens the notes, and its settings. */
const storageConfigSchema = z.strictObject({
  adapter: z.string().min(1),
  options: z.record(z.string(), z.unknown()).default({}),
});

const DEFAULT_CONFIG = { adapter: "sqlite", options: {} };

/**
 * The storage settings, or SQLite without `storage.json`. A file that can't
 * be read as settings stops the app rather than opening another store.
 */
const readStorageConfig = (dataDirectory: string) => {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dataDirectory, "storage.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_CONFIG;
    throw new Error("storage.json is not valid JSON.", { cause: error });
  }
  const parsed = storageConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const where = issue.path.join(".");
    throw new Error(
      `storage.json is not valid${where ? ` (${where})` : ""}: ${issue.message}. ` +
        'Expected { "adapter": "<name>", "options": { ... } }.',
    );
  }
  return parsed.data;
};

export const openStorageAdapter = (dataDirectory: string) => {
  mkdirSync(dataDirectory, { recursive: true });
  const config = readStorageConfig(dataDirectory);
  const create = STORAGE_ADAPTERS[config.adapter];
  if (!create) throw new Error(`Unknown storage adapter "${config.adapter}" in storage.json.`);
  return create({ dataDirectory, options: config.options });
};

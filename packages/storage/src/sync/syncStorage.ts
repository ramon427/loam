import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { readIfExists, writeFileAtomic } from "../files";

/**
 * Where a library's sync files live: a folder a cloud drive keeps in step, or
 * a sync server. Paths are relative and separated by "/".
 */
export type SyncStorage = {
  /** The path of every file under `prefix` (which ends in "/"). */
  list(prefix: string): Promise<string[]>;
  /** A file's bytes, or null when it doesn't exist or holds more than `maxBytes`. */
  read(path: string, maxBytes: number): Promise<Uint8Array | null>;
  /** Replaces a file in one step, so no reader sees it half written. */
  write(path: string, data: Uint8Array | string): Promise<void>;
  remove(path: string): Promise<void>;
  /** The largest file it can store. */
  maxFileBytes: number;
};

/** The folder Loam keeps its sync files in, inside the folder the user picked. */
const FOLDER_ROOT = join("Loam Sync", "v1");

/** Sync files in a folder a cloud drive (Dropbox, iCloud Drive, OneDrive, Syncthing…) syncs. */
export const folderStorage = (folder: string): SyncStorage => {
  const root = join(folder, FOLDER_ROOT);
  const resolve = (path: string) => join(root, ...path.split("/"));

  const walk = async (directory: string, prefix: string, paths: string[]) => {
    const entries = (await readIfExists(readdir(directory, { withFileTypes: true }))) ?? [];
    for (const entry of entries) {
      // Files being written aside (".name.tmp") and system files aren't sync files.
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory())
        await walk(join(directory, entry.name), `${prefix}${entry.name}/`, paths);
      else paths.push(`${prefix}${entry.name}`);
    }
  };

  return {
    async list(prefix) {
      const paths: string[] = [];
      await walk(resolve(prefix), prefix, paths);
      return paths;
    },
    async read(path, maxBytes) {
      const file = resolve(path);
      const info = await readIfExists(stat(file));
      if (!info || info.size > maxBytes) return null;
      return readIfExists(readFile(file));
    },
    async write(path, data) {
      const file = resolve(path);
      await mkdir(dirname(file), { recursive: true });
      await writeFileAtomic(file, data);
    },
    async remove(path) {
      await rm(resolve(path), { force: true });
    },
    maxFileBytes: Number.POSITIVE_INFINITY,
  };
};

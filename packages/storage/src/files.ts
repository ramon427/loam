import { randomUUID } from "node:crypto";
import { chmod, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** File-system helpers for the store's own files and the folders it reads and writes. */

/**
 * Writes a file aside and renames it over the old one, so a crash, a full disk
 * or a cloud drive syncing the folder never sees it half written. With `mode`,
 * the file has that mode even when it replaces one that had another (on
 * Windows, only the read-only bit applies; the user profile's permissions do
 * the rest).
 */
export const writeFileAtomic = async (
  path: string,
  data: string | Uint8Array,
  { mode }: { mode?: number } = {},
) => {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, data, { flag: "wx", ...(mode === undefined ? {} : { mode }) });
    // A new file's mode passes through the umask; set it exactly.
    if (mode !== undefined) await chmod(temporary, mode);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
};

/** What `read` gives, or null when the file or folder it reads doesn't exist. */
export const readIfExists = async <T>(read: Promise<T>): Promise<T | null> => {
  try {
    return await read;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

/**
 * True when `path` is strictly inside `directory` (not the directory itself).
 * Compares resolved paths and doesn't follow links; resolve them with
 * `realpath` first where a link could lead out.
 */
export const isInsideDirectory = (directory: string, path: string) => {
  const fromDirectory = relative(resolve(directory), resolve(path));
  return (
    fromDirectory !== "" &&
    fromDirectory !== ".." &&
    !fromDirectory.startsWith(`..${sep}`) &&
    !isAbsolute(fromDirectory)
  );
};

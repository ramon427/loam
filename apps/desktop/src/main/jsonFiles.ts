import { readFile } from "node:fs/promises";

import { readIfExists, writeFileAtomic } from "@loam/storage/files";

/**
 * Writes `value` as pretty-printed JSON, atomically. `private` files are
 * readable by their owner only (on Windows, the user profile's permissions
 * apply).
 */
export const writeJsonFile = (
  path: string,
  value: unknown,
  { private: isPrivate = false }: { private?: boolean } = {},
) => writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, isPrivate ? { mode: 0o600 } : {});

/** The parsed JSON in `path`, or null when the file doesn't exist. Invalid JSON throws. */
export const readJsonFile = async (path: string): Promise<unknown> => {
  const text = await readIfExists(readFile(path, "utf8"));
  return text === null ? null : JSON.parse(text);
};

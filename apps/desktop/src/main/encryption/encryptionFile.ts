import { readFile, rm } from "node:fs/promises";

import { readIfExists } from "@loam/storage/files";
import { readKeyLocks, type KeyLocks } from "@loam/storage/encryption/keyLocks";
import { isSealedValue, type SealedValue } from "@loam/storage/encryption/seal";

import { writeJsonFile } from "../jsonFiles";

export const ENCRYPTION_FILE_NAME = "encryption.json";
export const ENCRYPTION_FORMAT = 1;

/**
 * `encryption.json`: the library's key, locked by the passphrase and by the
 * recovery key. While encryption is turned on, off or re-keyed, `converting`
 * says what from, so a conversion a crash interrupted finishes after the next
 * unlock. `from` is the old key sealed under the new one (null: plain); `to:
 * "plain"` means encryption is being turned off and the file goes once done.
 */
export type EncryptionFile = {
  format: typeof ENCRYPTION_FORMAT;
  locks: KeyLocks;
  converting?: { from: SealedKey | null } | { to: "plain" };
};

type SealedKey = { keyId: string; key: SealedValue };

/** The file at `path`, or null when encryption is off; throws when it is damaged or newer. */
export const readEncryptionFile = async (path: string): Promise<EncryptionFile | null> => {
  const text = await readIfExists(readFile(path, "utf8"));
  if (text === null) return null;
  let parsed: Partial<EncryptionFile> | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Reported below.
  }
  const locks = readKeyLocks(parsed?.locks);
  const converting = parsed?.converting;
  const validConverting =
    converting === undefined ||
    (typeof converting === "object" &&
      converting !== null &&
      (("to" in converting && converting.to === "plain") ||
        ("from" in converting &&
          (converting.from === null ||
            (typeof converting.from?.keyId === "string" && isSealedValue(converting.from.key))))));
  if (parsed?.format !== ENCRYPTION_FORMAT || !locks || !validConverting)
    throw new Error(
      `${ENCRYPTION_FILE_NAME} is damaged or from a newer version of Loam. Your notes are encrypted and can't be opened without it; restore it from a copy of your data folder.`,
    );
  return { format: ENCRYPTION_FORMAT, locks, ...(converting ? { converting } : {}) };
};

/** Writes the file only its owner can read; null removes it (encryption is off). */
export const writeEncryptionFile = async (path: string, file: EncryptionFile | null) => {
  if (file) await writeJsonFile(path, file, { private: true });
  else await rm(path, { force: true });
};

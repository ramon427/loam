import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { BridgeSecurityStatus } from "@loam/shared/bridge/loamBridge";
import { writeFileAtomic } from "@loam/storage/files";
import { StoreError } from "@loam/storage/storeError";
import { type StorageAdapter } from "@loam/storage/adapter";
import {
  changePassphrase,
  createRecoveryKey,
  lockDataKey,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  unlockWithSecret,
} from "@loam/storage/encryption/keyLocks";
import {
  createDataKey,
  openDataKey,
  sealDataKey,
  type DataKey,
} from "@loam/storage/encryption/seal";

import { PLAIN_MEDIA, type MediaKeys } from "../mediaStore";
import {
  convertCopies,
  convertRecords,
  type LibraryKey,
  type LibraryParts,
} from "./convertLibrary";
import {
  ENCRYPTION_FILE_NAME,
  ENCRYPTION_FORMAT,
  readEncryptionFile,
  writeEncryptionFile,
  type EncryptionFile,
} from "./encryptionFile";

const MIN_PASSPHRASE_LENGTH = 8;

/** The text of a saved recovery key file. */
const recoveryKeyFileText = (recoveryKey: string) =>
  `Loam recovery key\n\n${recoveryKey}\n\n` +
  "If you forget your passphrase, this key is the only way to open your notes.\n" +
  "Keep it somewhere safe, away from this computer.\n";

const wrongSecret = (what: string) =>
  new StoreError(`That ${what} isn't right.`, "WRONG_PASSPHRASE", 403);

const readNewPassphrase = (passphrase: string) => {
  if (Array.from(passphrase).length < MIN_PASSPHRASE_LENGTH)
    throw new StoreError(
      `Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters.`,
      "VALIDATION_ERROR",
      400,
    );
  return passphrase;
};

/**
 * Whether notes are encrypted on this computer, the key while unlocked, and
 * turning encryption on and off. The key never leaves the main process.
 */
export const loadEncryption = async (dataDirectory: string) => {
  const path = join(dataDirectory, ENCRYPTION_FILE_NAME);
  let file = await readEncryptionFile(path);
  let key: DataKey | null = null;
  /** During a conversion: the key records may still be sealed with (null: plain). */
  let previous: DataKey | null = null;
  /** A recovery key shown for turning encryption on, used once it is turned on. */
  let pendingRecoveryKey: string | null = null;
  let converting = false;

  const write = async (next: EncryptionFile | null) => {
    await writeEncryptionFile(path, next);
    file = next;
  };

  /** Where records stand after unlocking: the conversion to finish, if one was interrupted. */
  const takeKey = (unlocked: DataKey) => {
    const pending = file!.converting;
    if (pending && "to" in pending) {
      // Turning off: the key is the one records may still be sealed with.
      key = null;
      previous = unlocked;
    } else {
      key = unlocked;
      previous = pending?.from ? openDataKey(pending.from.key, unlocked, pending.from.keyId) : null;
    }
  };

  const status = (): BridgeSecurityStatus => ({
    state: !file ? "off" : key || previous ? "on" : "locked",
  });

  const current = (): LibraryKey | null => (key && file ? { key, locks: file.locks } : null);

  /**
   * Turns encryption on, off, or to another key: every record, image, backup
   * and this device's sync files are rewritten in place. Each step skips what
   * is already done, so after a crash the same steps finish the job.
   */
  const finishConversion = async (parts: LibraryParts) => {
    const pending = file?.converting;
    if (!pending) return;
    const to = current();
    const mediaKeys: MediaKeys = { seal: to?.key ?? null, open: [previous, key] };
    await convertCopies(parts, { to, mediaKeys, previous });
    await write(to ? { format: ENCRYPTION_FORMAT, locks: to.locks } : null);
    previous = null;
  };

  /**
   * Turns encryption on, off or to another key while the app runs. A backup
   * is taken first, and sync waits until it is done.
   */
  const convert = async (
    parts: LibraryParts,
    target: LibraryKey | null,
    { turnOffSync }: { turnOffSync: boolean },
  ) => {
    if (converting || file?.converting)
      throw new StoreError(
        "Encryption is already changing. Restart Loam to finish it first.",
        "CONFLICT",
        409,
      );
    converting = true;
    try {
      const { sync, backups } = parts;
      if (turnOffSync && sync.folder()) {
        await sync.flush(10_000);
        await sync.turnOff();
      }
      await backups.create("before-encryption");
      const convertLibrary = async () => {
        const from = key;
        if (target) {
          await write({
            format: ENCRYPTION_FORMAT,
            locks: target.locks,
            converting: {
              from: from ? { keyId: from.id, key: sealDataKey(from, target.key) } : null,
            },
          });
          previous = from;
          key = target.key;
        } else {
          await write({
            format: ENCRYPTION_FORMAT,
            locks: file!.locks,
            converting: { to: "plain" },
          });
          previous = from;
          key = null;
        }
        try {
          await convertRecords(parts.inner, parts.store, { from: previous, to: key });
          await finishConversion(parts);
        } catch (error) {
          console.error("Encryption change failed", error);
          throw new StoreError(
            "Encryption couldn't finish changing your notes. Restart Loam to finish it; your notes were backed up first.",
            "ENCRYPTION_INCOMPLETE",
            500,
            { cause: error },
          );
        }
      };
      // No backup or sync reads the library while it is part old, part new.
      await sync.exclusive(() => backups.exclusive(convertLibrary));
    } finally {
      converting = false;
    }
  };

  const requireUnlocked = () => {
    if (!file || !key) throw new StoreError("Encryption is off.", "CONFLICT", 409);
    if (converting || file.converting)
      throw new StoreError("Encryption is changing. Try again in a moment.", "CONFLICT", 409);
    return { file, key };
  };

  return {
    status,
    current,
    /**
     * How images are sealed and opened right now. Plain images open only in
     * a plain library or while converting from or to plain (then `key` or
     * `previous` is null); a locked library opens none.
     */
    mediaKeys: (): MediaKeys => {
      if (!file) return PLAIN_MEDIA;
      if (!key && !previous) return { seal: null, open: [] };
      return { seal: key, open: file.converting ? [key, previous] : [key] };
    },

    /** Unlocks with the passphrase. */
    async unlock(passphrase: string) {
      if (!file) return;
      const unlocked = await unlockWithPassphrase(file.locks, passphrase);
      if (!unlocked) throw wrongSecret("passphrase");
      takeKey(unlocked);
    },

    /** Unlocks with the recovery key and makes `passphrase` the new passphrase. */
    async resetPassphrase(recoveryKey: string, passphrase: string) {
      if (!file) return;
      const next = readNewPassphrase(passphrase);
      const unlocked = await unlockWithRecoveryKey(file.locks, recoveryKey);
      if (!unlocked) throw wrongSecret("recovery key");
      await write({ ...file, locks: await changePassphrase(file.locks, unlocked, next) });
      takeKey(unlocked);
    },

    /** Records of a conversion interrupted before they were all rewritten; at launch, before the store opens. */
    async resumeRecords(inner: StorageAdapter) {
      if (file?.converting) await convertRecords(inner, null, { from: previous, to: key });
    },

    /** The rest of an interrupted conversion, once the store and services are running. */
    async resumeConversion(parts: LibraryParts) {
      if (!file?.converting) return;
      // Nothing syncs or backs up the library until it is all in one form.
      await parts.sync.exclusive(() => parts.backups.exclusive(() => finishConversion(parts)));
    },

    /** A recovery key to show before turning encryption on. */
    newRecoveryKey() {
      if (file) throw new StoreError("Your notes are already encrypted.", "CONFLICT", 409);
      pendingRecoveryKey = createRecoveryKey();
      return pendingRecoveryKey;
    },

    pendingRecoveryKey: () => pendingRecoveryKey,

    /**
     * Saves the recovery key just shown to a file only its owner can read.
     * Without `replace`, an existing file is left alone.
     */
    async saveRecoveryKey(path: string, { replace }: { replace: boolean }) {
      if (!pendingRecoveryKey)
        throw new StoreError("Generate a recovery key first.", "VALIDATION_ERROR", 400);
      const text = recoveryKeyFileText(pendingRecoveryKey);
      if (replace) {
        await writeFileAtomic(path, text, { mode: 0o600 });
        return;
      }
      try {
        await writeFile(path, text, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        throw new StoreError("That file already exists. Choose a new file.", "CONFLICT", 409);
      }
    },

    /** Encrypts every note with a new key locked by `passphrase` and the recovery key just shown. */
    async enable(parts: LibraryParts, passphraseInput: string, recoveryKeyInput: string) {
      const passphrase = readNewPassphrase(passphraseInput);
      if (file) throw new StoreError("Your notes are already encrypted.", "CONFLICT", 409);
      // Only the key the user was shown (and saved) may lock the notes.
      const recoveryKey = pendingRecoveryKey;
      if (!recoveryKey || recoveryKeyInput !== recoveryKey)
        throw new StoreError(
          "That recovery key is out of date. Start again to get a new one.",
          "VALIDATION_ERROR",
          400,
        );
      if (await parts.sync.readFolderLocks())
        throw new StoreError(
          "Your sync folder's notes are already encrypted. Enter their passphrase in Settings › Sync to use it here too.",
          "CONFLICT",
          409,
        );
      const newKey = createDataKey();
      const locks = await lockDataKey(newKey, { passphrase, recoveryKey });
      await convert(parts, { key: newKey, locks }, { turnOffSync: false });
      pendingRecoveryKey = null;
    },

    /** Decrypts every note; the passphrase confirms it. Sync is turned off. */
    async disable(parts: LibraryParts, passphrase: string) {
      const { file: current } = requireUnlocked();
      if (!(await unlockWithPassphrase(current.locks, passphrase))) throw wrongSecret("passphrase");
      await convert(parts, null, { turnOffSync: true });
    },

    /**
     * Uses the key of the sync folder's encrypted notes here too, unlocked by
     * its passphrase or recovery key: this library is converted to that key,
     * and its passphrase becomes this computer's.
     */
    async adoptSyncFolderKey(parts: LibraryParts, secret: string) {
      const locks = await parts.sync.readFolderLocks();
      if (!locks) return;
      if (key?.id === locks.keyId) return;
      const folderKey = await unlockWithSecret(locks, secret);
      if (!folderKey) throw wrongSecret("passphrase or recovery key");
      await convert(parts, { key: folderKey, locks }, { turnOffSync: false });
    },

    async changePassphrase(parts: LibraryParts, currentPassphrase: string, nextInput: string) {
      const { file: current, key: unlocked } = requireUnlocked();
      const next = readNewPassphrase(nextInput);
      if (!(await unlockWithPassphrase(current.locks, currentPassphrase)))
        throw wrongSecret("passphrase");
      const locks = await changePassphrase(current.locks, unlocked, next);
      // Encryption may have changed while scrypt ran; then this passphrase is for a key no longer used.
      const latest = requireUnlocked();
      if (latest.key.id !== unlocked.id)
        throw new StoreError("Encryption changed meanwhile. Try again.", "CONFLICT", 409);
      await write({ ...latest.file, locks });
      // Computers that join the sync folder later unlock with the new passphrase.
      await (await parts.sync.openFolder({ key: unlocked, locks }))?.updateLocks(locks);
    },
  };
};

export type EncryptionManager = Awaited<ReturnType<typeof loadEncryption>>;

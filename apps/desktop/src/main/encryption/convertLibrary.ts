import type { StorageAdapter } from "@loam/storage/adapter";
import { convertStoredRecords, withEncryption } from "@loam/storage/encryption/encryptedAdapter";
import type { KeyLocks } from "@loam/storage/encryption/keyLocks";
import type { DataKey } from "@loam/storage/encryption/seal";
import type { NotesStore } from "@loam/storage/NotesStore";
import { StoreError } from "@loam/storage/storeError";

import type { BackupManager } from "../backups/backups";
import { convertMediaFolder, mediaConverter, type MediaKeys } from "../mediaStore";
import type { SyncService } from "../sync";

/** The key notes are sealed with and its locks, as backups and sync need them. */
export type LibraryKey = { key: DataKey; locks: KeyLocks };

/** What a conversion rewrites. */
export type LibraryParts = {
  /** The storage backend itself, beneath encryption. */
  inner: StorageAdapter;
  mediaDirectory: string;
  store: NotesStore;
  backups: BackupManager;
  sync: SyncService;
};

/** Stands in for the store's records while a failed conversion waits for a restart. */
const blockedAdapter = (name: string): StorageAdapter => {
  const blocked = async (): Promise<never> => {
    throw new StoreError(
      "Encryption couldn't finish changing your notes. Restart Loam to finish it.",
      "ENCRYPTION_INCOMPLETE",
      503,
    );
  };
  return { name, get: blocked, list: blocked, commit: blocked };
};

/**
 * Converts the store's records from one key to another (null: plain) and
 * carries on with them: live, or before the store opens (`store` null).
 * Records already converted are skipped, so it can run again after a crash.
 */
export const convertRecords = async (
  inner: StorageAdapter,
  store: NotesStore | null,
  keys: { from: DataKey | null; to: DataKey | null },
) => {
  if (!store) {
    await convertStoredRecords(inner, keys);
    return;
  }
  let failure: unknown = null;
  await store.replaceAdapter(async () => {
    try {
      await convertStoredRecords(inner, keys);
      return withEncryption(inner, keys.to);
    } catch (error) {
      // Records are now part old, part new: nothing may read or write them until a restart finishes the job.
      failure = error;
      return blockedAdapter(inner.name);
    }
  });
  if (failure) throw failure;
};

/**
 * Converts everything beside the records to `to` (null: plain): the
 * images, this device's sync files, and old backups. Each step skips what
 * is already done.
 */
export const convertCopies = async (
  parts: LibraryParts,
  {
    to,
    mediaKeys,
    previous,
  }: { to: LibraryKey | null; mediaKeys: MediaKeys; previous: DataKey | null },
) => {
  await convertMediaFolder(parts.mediaDirectory, mediaKeys);
  // The sync folder and old backups are copies: a folder that can't be
  // reached, or a damaged backup, must not keep the library from opening.
  const syncFolder = to ? await parts.sync.openFolder(to) : null;
  if (syncFolder && to) {
    try {
      await syncFolder.resealOwnFiles(previous, to);
      await syncFolder.convertMedia(mediaConverter(mediaKeys));
    } catch (error) {
      console.error("Could not reseal the sync folder; publishing everything again", error);
      // The next sync publishes every note again, sealed with the new key.
      await parts.store.requestRepublish();
    }
  }
  if (to) await parts.backups.sealPlainBackups(to);
};

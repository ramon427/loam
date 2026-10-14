import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { shell } from "electron";

import type { BridgeBackup, BridgeBackupKind } from "@loam/shared/bridge/loamBridge";
import type { NotesStore } from "@loam/storage/NotesStore";
import { StoreError } from "@loam/storage/storeError";
import { unlockWithSecret, type KeyLocks } from "@loam/storage/encryption/keyLocks";
import { recordContext } from "@loam/storage/encryption/encryptedAdapter";
import { isSealedValue, openValue, type DataKey } from "@loam/storage/encryption/seal";

import { convertMediaFolder, copyMissingMedia, mediaConverter } from "../mediaStore";
import {
  fileNameFor,
  fileRecords,
  invalidBackup,
  parseFileName,
  readBackupFile,
  SAFETY_KINDS,
  selectBackupsToKeep,
  writeBackupStream,
  type BackupEncryption,
  type BackupFile,
} from "./backupFiles";

const DAY_MS = 24 * 60 * 60 * 1000;

const lockedBackup = (message: string) => new StoreError(message, "BACKUP_LOCKED", 403);

/**
 * Backups of the whole library: a gzipped JSON copy of every store record,
 * whatever the storage backend, plus a mirror of the media folder next to
 * them. They are taken daily, on demand and before restores and imports.
 */
export const createBackupManager = ({
  store,
  directory,
  mediaDirectory,
  appVersion,
  encryption = () => null,
  onRestored = () => undefined,
  now = Date.now,
}: {
  store: NotesStore;
  /** Where backups are written; the media mirror is its `media` folder. */
  directory: string;
  mediaDirectory: string;
  appVersion: string;
  /** The library's key while encryption is on: backups are sealed with it. */
  encryption?: () => BackupEncryption;
  /** Called once a restore has replaced the library. */
  onRestored?: () => void;
  now?: () => number;
}) => {
  const mediaMirror = join(directory, "media");
  let running: Promise<unknown> | null = null;
  let lastError: string | null = null;
  /** An encrypted backup file asks for its passphrase; the retry restores the same file. */
  let lastPickedFile: string | null = null;

  const list = async (): Promise<BridgeBackup[]> => {
    let names: string[];
    try {
      names = await readdir(directory);
    } catch {
      return [];
    }
    const backups: BridgeBackup[] = [];
    for (const name of names) {
      const parsed = parseFileName(name);
      if (!parsed) continue;
      backups.push({ ...parsed, sizeBytes: (await stat(join(directory, name))).size });
    }
    return backups.sort((left, right) => right.createdAt - left.createdAt);
  };

  const prune = async () => {
    const backups = await list();
    const keep = selectBackupsToKeep(backups);
    for (const backup of backups) {
      if (!keep.has(backup.id)) await rm(join(directory, backup.id), { force: true });
    }
    // Left by a write that crashed; only one backup is written at a time.
    for (const name of await readdir(directory)) {
      if (name.endsWith(".partial")) await rm(join(directory, name), { force: true });
    }
  };

  const write = async (kind: BridgeBackupKind): Promise<BridgeBackup> => {
    const createdAt = now();
    await mkdir(directory, { recursive: true });
    const id = fileNameFor(createdAt, kind);
    // Written aside first, so a crash mid-write never leaves a broken backup.
    const partial = join(directory, `${id}.partial`);
    await writeBackupStream(partial, store.streamAllRecords(), {
      createdAt,
      appVersion,
      encryption: encryption(),
    });
    await rename(partial, join(directory, id));
    await copyMissingMedia(mediaDirectory, mediaMirror);
    await prune();
    return { id, createdAt, kind, sizeBytes: (await stat(join(directory, id))).size };
  };

  /** Runs `run` when no other backup work is running; later work waits for it. */
  const exclusive = async <T>(run: () => Promise<T>): Promise<T> => {
    while (running) await running.catch(() => undefined);
    const current = run();
    running = current;
    try {
      return await current;
    } finally {
      running = null;
    }
  };

  /** Writes a backup inside `exclusive`; remembers why the last one failed until one succeeds. */
  const writeRecordingErrors = async (kind: BridgeBackupKind) => {
    try {
      const info = await write(kind);
      lastError = null;
      return info;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  };

  const create = (kind: BridgeBackupKind) => exclusive(() => writeRecordingErrors(kind));

  /**
   * The key a backup's records are sealed with: the library's own, or the one
   * `secret` (that backup's passphrase or recovery key) unlocks.
   */
  const unlockBackup = async (locks: KeyLocks, secret: string | undefined) => {
    const current = encryption();
    if (current?.key.id === locks.keyId) return current.key;
    if (secret === undefined)
      throw lockedBackup(
        "That backup is encrypted with another passphrase. Enter it, or its recovery key, to restore it.",
      );
    const key = await unlockWithSecret(locks, secret);
    if (!key) throw lockedBackup("That passphrase or recovery key doesn't unlock this backup.");
    return key;
  };

  /** A backup's records with their values opened. */
  const openRecords = (file: BackupFile, key: DataKey | null) => {
    if (!key) return file.collections;
    return Object.fromEntries(
      Object.entries(file.collections).map(([collection, records]) => [
        collection,
        (records ?? []).map((record) => {
          if (!isSealedValue(record.value)) throw invalidBackup("That backup is damaged.");
          try {
            return {
              id: record.id,
              value: openValue([key], record.value, recordContext(collection, record.id)),
            };
          } catch {
            throw invalidBackup("That backup is damaged.");
          }
        }),
      ]),
    ) as BackupFile["collections"];
  };

  const lastScheduledBackupAt = async () =>
    (await list()).find((backup) => !SAFETY_KINDS.has(backup.kind))?.createdAt ?? null;

  /**
   * Replaces every note with a backup's: one listed by `id`, or a backup
   * file at `path`. The current library is backed up first, so a restore
   * can itself be undone by restoring that backup.
   */
  const restore = async (source: { id: string } | { path: string }, secret?: string) => {
    let path: string;
    if ("id" in source) {
      if (!parseFileName(source.id)) throw invalidBackup("Unknown backup.");
      path = join(directory, source.id);
    } else path = source.path;
    const file = await readBackupFile(path);
    const key = file.encryption ? await unlockBackup(file.encryption, secret) : null;
    const collections = openRecords(file, key);
    // One step: no scheduled backup reads the library while it is being replaced.
    return exclusive(async () => {
      await writeRecordingErrors("before-restore");
      // The store seals them with the library's key, if it uses one.
      await store.replaceAllRecords(collections);
      // Images live beside the backup; bring back any this library lacks.
      const backupMedia = "id" in source ? mediaMirror : join(dirname(path), basename(mediaMirror));
      const current = encryption()?.key ?? null;
      await copyMissingMedia(
        backupMedia,
        mediaDirectory,
        mediaConverter({ seal: current, open: [key, current] }),
      );
      onRestored();
      return { createdAt: file.createdAt };
    });
  };

  return {
    directory,
    list,
    create,
    lastError: () => lastError,
    restore,

    /**
     * Restores a backup file `pick` asks the user for, or, given `secret`,
     * the file picked last.
     */
    async restorePickedFile(
      pick: () => Promise<string | null>,
      secret?: string,
    ): Promise<{ status: "canceled" } | { status: "restored"; createdAt: number }> {
      const path = secret !== undefined && lastPickedFile ? lastPickedFile : await pick();
      if (!path) return { status: "canceled" };
      lastPickedFile = path;
      return { status: "restored", ...(await restore({ path }, secret)) };
    },

    /** Opens the backups folder in the file manager, making it first if it isn't there yet. */
    async reveal() {
      await mkdir(directory, { recursive: true });
      await shell.openPath(directory);
    },

    /** Takes the daily backup when the newest scheduled one is a day old or missing. */
    async backUpIfDue() {
      const last = await lastScheduledBackupAt();
      if (last !== null && now() - last < DAY_MS) return null;
      return create("auto");
    },

    /**
     * Seals every plain backup, and the images beside them, with the
     * library's key (when encryption is turned on). Each is rewritten aside
     * and then swapped in, so a crash never leaves a broken backup; a damaged
     * one is left as it is. Run it inside `exclusive`.
     */
    async sealPlainBackups(target: NonNullable<BackupEncryption>) {
      for (const backup of await list()) {
        const path = join(directory, backup.id);
        let file: BackupFile;
        try {
          file = await readBackupFile(path);
        } catch (error) {
          console.error(`Backup ${backup.id} is unreadable; left as it is`, error);
          continue;
        }
        if (file.encryption) continue;
        const partial = `${path}.partial`;
        await writeBackupStream(partial, fileRecords(file), {
          createdAt: file.createdAt,
          appVersion: file.appVersion,
          encryption: target,
        });
        await rename(partial, path);
      }
      await convertMediaFolder(mediaMirror, { seal: target.key, open: [null] });
    },

    exclusive,
  };
};

export type BackupManager = ReturnType<typeof createBackupManager>;

import { join } from "node:path";

import type { BridgeSyncStatus } from "@loam/shared/bridge/loamBridge";
import type { NotesChange } from "@loam/shared/notes/noteModel";
import { NotesStore } from "@loam/storage/NotesStore";
import { withEncryption } from "@loam/storage/encryption/encryptedAdapter";

import { createBackupManager, type BackupManager } from "./backups/backups";
import type { LibraryParts } from "./encryption/convertLibrary";
import type { EncryptionManager } from "./encryption/encryption";
import { createMarkdownExporter } from "./markdownExport";
import { createMediaStore } from "./mediaStore";
import { createTabFiles } from "./tabFiles";
import { createNotesImporter } from "./import/sessions";
import { openStorageAdapter } from "./storage";
import { createSyncService, type SyncTiming } from "./sync";

const BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const BACKUP_STARTUP_DELAY_MS = 60 * 1000;

/** Takes the daily backup a minute after opening and then whenever a day has passed. */
const scheduleBackups = (backups: BackupManager) => {
  const check = () =>
    void backups.backUpIfDue().catch((error: unknown) => {
      console.error("Automatic backup failed", error);
    });
  const startup = setTimeout(check, BACKUP_STARTUP_DELAY_MS);
  const interval = setInterval(check, BACKUP_CHECK_INTERVAL_MS);
  startup.unref();
  interval.unref();
  return () => {
    clearTimeout(startup);
    clearInterval(interval);
  };
};

/**
 * Opens the notes in a data folder with everything that keeps them: images,
 * backups, sync, import and export, each using the library's key while
 * encryption is on. A conversion a crash interrupted is finished first.
 */
export const openLibrary = async ({
  dataDirectory,
  encryption,
  appVersion,
  onSyncStatus,
  onNotesChange,
  onRestored,
  onLinkedFileChange,
  syncTiming,
}: {
  dataDirectory: string;
  encryption: EncryptionManager;
  appVersion: string;
  onSyncStatus: (status: BridgeSyncStatus) => void;
  /** Changes made from outside the window: by sync or an AI client. */
  onNotesChange: (change: NotesChange) => void;
  /** Restarts the app once a restore has replaced the library. */
  onRestored: () => void;
  /** A file a tab links to, which the window watches, changed on disk. */
  onLinkedFileChange: (path: string) => void;
  syncTiming?: SyncTiming;
}) => {
  const inner = openStorageAdapter(dataDirectory);
  // Records an interrupted conversion left behind are rewritten before anything reads them.
  await encryption.resumeRecords(inner);
  const store = await NotesStore.open({
    adapter: withEncryption(inner, encryption.current()?.key ?? null),
  });
  const media = createMediaStore(join(dataDirectory, "media"), () => encryption.mediaKeys());
  const backups = createBackupManager({
    store,
    directory: join(dataDirectory, "backups"),
    mediaDirectory: media.directory,
    appVersion,
    encryption: () => encryption.current(),
    onRestored,
  });
  const sync = await createSyncService({
    store,
    dataDirectory,
    mediaDirectory: media.directory,
    onStatus: onSyncStatus,
    encryption: () => encryption.current(),
    ...(syncTiming ? { timing: syncTiming } : {}),
  });
  const parts: LibraryParts = { inner, mediaDirectory: media.directory, store, backups, sync };
  try {
    await encryption.resumeConversion(parts);
  } catch (error) {
    // Nothing runs on a half-converted library; unlocking again tries once more.
    await sync.stop();
    await store.close();
    throw error;
  }
  store.onChange(({ external, ...change }) => {
    if (external) onNotesChange(change);
  });
  const stopBackups = scheduleBackups(backups);
  const files = await createTabFiles({
    media,
    deviceId: store.deviceId,
    linkedPathsFile: join(dataDirectory, "linked-files.json"),
    linkedBefore: async () => {
      const paths: string[] = [];
      for (const { id } of (await store.getLibrary()).notes)
        for (const { source } of Object.values((await store.getNote(id)).filesByTab ?? {}))
          if (source.kind === "referenced" && source.computerId === store.deviceId)
            paths.push(source.path);
      return paths;
    },
    onLinkedFileChange,
  });
  return {
    store,
    media,
    files,
    backups,
    sync,
    importer: createNotesImporter({
      store,
      media,
      beforeFirstWrite: () => backups.create("before-import"),
    }),
    exporter: createMarkdownExporter({
      store,
      mediaDirectory: media.directory,
      mediaKeys: () => encryption.mediaKeys(),
    }),
    /** What turning encryption on or off rewrites. */
    parts,
    /**
     * Closes the store. Given `syncFlushMs` (when quitting), sync first
     * publishes what is waiting for up to that long; otherwise it stops at once.
     */
    async close(syncFlushMs = 0) {
      stopBackups();
      files.close();
      if (syncFlushMs > 0) await sync.flush(syncFlushMs).catch(() => undefined);
      else await sync.stop();
      await store.close();
    },
  };
};

export type OpenLibrary = Awaited<ReturnType<typeof openLibrary>>;

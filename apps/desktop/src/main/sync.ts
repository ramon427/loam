import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { BridgeSyncStatus } from "@loam/shared/bridge/loamBridge";
import { isInsideDirectory } from "@loam/storage/files";
import { StoreError } from "@loam/storage/storeError";
import { type NotesStore } from "@loam/storage/NotesStore";
import type { KeyLocks } from "@loam/storage/encryption/keyLocks";
import {
  SyncFolder,
  SyncFolderError,
  SyncFolderLockedError,
  syncWithFolder,
  type SyncEncryption,
} from "@loam/storage/sync/syncFolder";
import {
  describeSyncServer,
  parseSyncCode,
  serverStorage,
  type SyncServer,
} from "@loam/storage/sync/syncServer";
import { folderStorage, type SyncStorage } from "@loam/storage/sync/syncStorage";

import type { SecretBox } from "./google/googleAccount";
import { readJsonFile, writeJsonFile } from "./jsonFiles";
import { exchangeMedia, mediaConverter } from "./mediaStore";

/**
 * Where sync goes: `{ folder }`, or `{ folder: null, server }` with the
 * server's key sealed by the operating system's keychain. Versions before
 * sync servers read the second as sync turned off.
 */
const CONFIG_FILE = "sync.json";

/** A folder a cloud drive syncs, or a sync server with its storage kept across syncs. */
type SyncTarget =
  { kind: "folder"; folder: string } | { kind: "server"; server: SyncServer; storage: SyncStorage };

/** When sync runs. Tests shorten these. */
export type SyncTiming = {
  /** After a change here: wait this long for the next one… */
  afterChangeMs: number;
  /** …but publish at least this often while changes keep coming. */
  maxWaitMs: number;
  /** How often to look for other devices' changes. */
  pollMs: number;
  /** First retry after a failure; doubles up to `maxRetryMs`. */
  retryMs: number;
  maxRetryMs: number;
};

const DEFAULT_TIMING: SyncTiming = {
  afterChangeMs: 2_000,
  maxWaitMs: 10_000,
  pollMs: 30_000,
  retryMs: 5_000,
  maxRetryMs: 5 * 60_000,
};

/** Doubling backoff with ±20% jitter, so devices that failed together don't retry together. */
const retryDelayMs = (attempt: number, timing: SyncTiming, random = Math.random) =>
  Math.round(
    Math.min(timing.retryMs * 2 ** Math.min(attempt - 1, 10), timing.maxRetryMs) *
      (0.8 + random() * 0.4),
  );

const describeError = (error: unknown) => {
  if (error instanceof SyncFolderError) return error.message;
  const code = (error as NodeJS.ErrnoException).code;
  if (code)
    return `Can't reach the sync folder (${code}). Changes are kept here and sync once it's back.`;
  return error instanceof Error ? error.message : String(error);
};

const readConfiguredTarget = async (
  dataDirectory: string,
  secrets: SecretBox,
  fetchImpl: typeof fetch,
): Promise<SyncTarget | null> => {
  let config: unknown;
  try {
    config = await readJsonFile(join(dataDirectory, CONFIG_FILE));
  } catch (error) {
    console.error(`${CONFIG_FILE} can't be read; sync stays off until a folder is chosen`, error);
    return null;
  }
  const { folder, server } = (config ?? {}) as { folder?: unknown; server?: unknown };
  if (typeof folder === "string" && folder) return { kind: "folder", folder };
  const { url, key } = (server ?? {}) as { url?: unknown; key?: unknown };
  if (typeof url !== "string" || typeof key !== "string") return null;
  const parsed = parseSyncCode(`${url}#${secrets.open(key) ?? ""}`);
  if (!parsed) {
    console.error(`The sync code in ${CONFIG_FILE} can't be opened; sync stays off`);
    return null;
  }
  return { kind: "server", server: parsed, storage: serverStorage(parsed, fetchImpl) };
};

const storageOf = (target: SyncTarget) =>
  target.kind === "folder" ? folderStorage(target.folder) : target.storage;

/** True when one folder is the other or holds it. */
const overlaps = (left: string, right: string) =>
  resolve(left) === resolve(right) ||
  isInsideDirectory(left, right) ||
  isInsideDirectory(right, left);

/**
 * Background sync through a folder: runs shortly after changes made here,
 * every half minute for changes from other devices, and retries with backoff
 * while the folder can't be reached. Edits never wait for it; they are saved
 * here first and published by the next run. What other devices changed is
 * reported by the store as it applies it.
 */
export const createSyncService = async ({
  store,
  dataDirectory,
  mediaDirectory,
  onStatus,
  encryption = () => null,
  secrets,
  fetchImpl = fetch,
  timing = DEFAULT_TIMING,
}: {
  store: NotesStore;
  dataDirectory: string;
  mediaDirectory: string;
  onStatus: (status: BridgeSyncStatus) => void;
  /** The key notes are sealed with while encryption is on. */
  encryption?: () => SyncEncryption;
  /** Seals a sync server's key in sync.json. */
  secrets: SecretBox;
  fetchImpl?: typeof fetch;
  timing?: SyncTiming;
}) => {
  let target = await readConfiguredTarget(dataDirectory, secrets, fetchImpl);
  let running: Promise<void> | null = null;
  /** Set while encryption is turned on or off: nothing syncs until it is done. */
  let paused = false;
  let locked = false;
  let runAgain = false;
  let lastSyncedAt: number | null = null;
  let error: string | null = null;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timerDueAt = 0;
  let firstChangeAt: number | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;

  const status = async (): Promise<BridgeSyncStatus> => ({
    folder: target?.kind === "folder" ? target.folder : null,
    server: target?.kind === "server" ? describeSyncServer(target.server) : null,
    state: !target ? "off" : running ? "syncing" : error ? "error" : "synced",
    lastSyncedAt,
    error: target ? error : null,
    // While sync is off nothing reads the sync records.
    unpublished: target ? await store.countUnpublishedChanges() : 0,
    needsPassphrase: Boolean(target && error && locked),
  });

  const emitStatus = (override?: Partial<BridgeSyncStatus>) =>
    void status().then((current) => onStatus({ ...current, ...override }));

  const runOnce = async (current: SyncTarget) => {
    const keys = encryption();
    const syncFolder = new SyncFolder(storageOf(current), await store.readSyncDevice(), keys);
    await syncWithFolder(store, syncFolder);
    // Images arrive the way this library keeps them: sealed while encryption is on.
    await exchangeMedia(
      mediaDirectory,
      syncFolder,
      keys ? mediaConverter({ seal: keys.key, open: [keys.key] }) : undefined,
    );
  };

  /** Runs now, or once more right after the run in progress. */
  const sync = (): Promise<void> => {
    if (running) {
      runAgain = true;
      return running;
    }
    if (paused) return Promise.resolve();
    clearTimer();
    running = (async () => {
      do {
        runAgain = false;
        const current = target;
        if (!current) return;
        emitStatus({ state: "syncing" });
        try {
          await runOnce(current);
          if (target !== current) continue;
          lastSyncedAt = Date.now();
          error = null;
          locked = false;
          failures = 0;
        } catch (cause) {
          if (target !== current) continue;
          error = describeError(cause);
          locked = cause instanceof SyncFolderLockedError;
          failures += 1;
          if (!locked) console.error("Sync failed", cause);
        }
      } while (runAgain);
    })().finally(() => {
      running = null;
      firstChangeAt = null;
      emitStatus();
      if (error && target) schedule(retryDelayMs(failures, timing));
    });
    return running;
  };

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  /** Runs after `delayMs`, unless a run is already due sooner. */
  function schedule(delayMs: number) {
    if (!target) return;
    const dueAt = Date.now() + delayMs;
    if (timer && timerDueAt <= dueAt) return;
    clearTimer();
    timerDueAt = dueAt;
    timer = setTimeout(() => {
      timer = null;
      void sync();
    }, delayMs);
    timer.unref?.();
  }

  // Changes made here publish after a short pause, and at least every `maxWaitMs`.
  // While a run failed, the retry already scheduled publishes them.
  store.onLocalChange(() => {
    if (!target) return;
    if (!error) {
      const now = Date.now();
      firstChangeAt ??= now;
      clearTimer();
      schedule(Math.max(0, Math.min(timing.afterChangeMs, firstChangeAt + timing.maxWaitMs - now)));
    }
    emitStatus();
  });

  const startPolling = () => {
    if (poll) clearInterval(poll);
    poll = setInterval(() => {
      if (!error) void sync();
    }, timing.pollMs);
    poll.unref?.();
  };

  // The first sync waits a moment, so it doesn't compete with opening the window.
  if (target) {
    startPolling();
    schedule(timing.afterChangeMs);
  }

  /** This device's view of the sync folder or server, sealing with `keys`. */
  const openFolder = async (keys: SyncEncryption) =>
    target ? new SyncFolder(storageOf(target), await store.readSyncDevice(), keys) : null;

  /** Syncs through `next` from now on, starting with a sync. */
  const switchTo = async (next: SyncTarget, config: unknown) => {
    await writeJsonFile(join(dataDirectory, CONFIG_FILE), config, { private: true });
    target = next;
    error = null;
    locked = false;
    failures = 0;
    startPolling();
    await sync();
    return status();
  };

  return {
    status,

    /** Syncs through the folder `folder` from now on, starting with a sync. */
    async useFolder(folder: string) {
      if (overlaps(folder, dataDirectory))
        throw new StoreError(
          "Pick a folder outside Loam' own data folder, for example one in Dropbox or iCloud Drive.",
          "VALIDATION_ERROR",
          400,
        );
      await mkdir(folder, { recursive: true });
      return switchTo({ kind: "folder", folder }, { folder });
    },

    /** Syncs through the sync server a sync code names, once it answers to the code. */
    async useServer(code: string) {
      const server = parseSyncCode(code);
      if (!server)
        throw new StoreError(
          "That isn't a sync code. Copy the whole code, starting with https://.",
          "VALIDATION_ERROR",
          400,
        );
      if (!secrets.canEncrypt())
        throw new StoreError(
          "This computer can't encrypt the sync code, so Loam can't keep it.",
          "UNAVAILABLE",
          503,
        );
      const storage = serverStorage(server, fetchImpl);
      try {
        await storage.list("devices/");
      } catch (cause) {
        throw new StoreError(describeError(cause), "UNAVAILABLE", 503);
      }
      return switchTo(
        { kind: "server", server, storage },
        { folder: null, server: { url: server.url, key: secrets.seal(server.key) } },
      );
    },

    async syncNow() {
      await sync();
      return status();
    },

    /** Whether sync is on. */
    isOn: () => target !== null,

    openFolder,

    /** The key locks of the sync folder's notes, when they are encrypted. */
    async readFolderLocks(): Promise<KeyLocks | null> {
      return (await openFolder(null))?.readLocks() ?? null;
    },

    /**
     * Runs `run` with sync stopped: waits for a sync in progress, and starts
     * none until `run` is done (encryption being turned on or off).
     */
    async exclusive<T>(run: () => Promise<T>): Promise<T> {
      paused = true;
      clearTimer();
      try {
        await running?.catch(() => undefined);
        return await run();
      } finally {
        paused = false;
        error = null;
        locked = false;
        failures = 0;
        if (target) schedule(0);
        emitStatus();
      }
    },

    /** Stops syncing; notes stay here and in the folder or on the server. */
    async turnOff() {
      target = null;
      clearTimer();
      if (poll) clearInterval(poll);
      poll = null;
      await writeJsonFile(join(dataDirectory, CONFIG_FILE), { folder: null });
      await running?.catch(() => undefined);
      emitStatus();
      return status();
    },

    /** Stops syncing in the background, keeping the settings (when the store closes). */
    async stop() {
      clearTimer();
      if (poll) clearInterval(poll);
      poll = null;
      paused = true;
      await running?.catch(() => undefined);
    },

    /** Publishes what is waiting before the app quits, giving up after `timeoutMs`. */
    async flush(timeoutMs: number) {
      clearTimer();
      if (poll) clearInterval(poll);
      poll = null;
      if (!target || (!running && (await store.countUnpublishedChanges()) === 0)) return;
      await Promise.race([sync(), new Promise((done) => setTimeout(done, timeoutMs))]);
    },
  };
};

export type SyncService = Awaited<ReturnType<typeof createSyncService>>;

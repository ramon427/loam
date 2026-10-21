import { randomUUID } from "node:crypto";

import { readKeyLocks, type KeyLocks } from "../encryption/keyLocks";
import { isSealedValue, openValue, sealValue, type DataKey } from "../encryption/seal";
import { isStoredMediaName } from "@loam/shared/notes/mediaFiles";
import type { NotesChange } from "@loam/shared/notes/noteModel";
import { forEachConcurrently } from "@loam/shared/utils/concurrency";

import type { NotesStore } from "../NotesStore";
import { CLOCK_PATTERN, DEVICE_ID_PATTERN } from "./clock";
import { readSyncChange, type SyncChange, type SyncChangeRef, type SyncDocKey } from "./syncDocs";
import type { SyncStorage } from "./syncStorage";

/**
 * Sync through files every computer can reach: a folder a cloud drive
 * (Dropbox, iCloud Drive, OneDrive, Syncthing…) keeps in step, or a sync
 * server that only stores files (see `SyncStorage`).
 *
 *   library.json                 which library this is
 *   devices/<device>/            one folder per device
 *     <kind>-<id>~<clock>.json       its latest version of a document
 *   media/<name>                 every image and file the notes show
 *
 * Each device writes only inside its own folder, so a cloud drive never sees
 * two computers edit one file. A document's file is replaced when it changes,
 * so the drive uploads just the notes that changed. Readers skip any file whose
 * clock they already hold, which makes files that arrive out of order, twice,
 * or half-written (skipped until complete) harmless.
 *
 * An encrypted library's library.json holds its data key, locked by the
 * passphrase and the recovery key, and every change file is sealed with it.
 * File names (document ids and clocks) stay readable.
 */

const LIBRARY_FILE = "library.json";
/** 2: the library is encrypted. Older versions refuse it rather than read it wrong. */
const LIBRARY_FORMAT = { plain: 1, encrypted: 2 };
/** Versions before projects skip `project-` files: their pattern doesn't match them. */
const FILE_PATTERN = new RegExp(
  `^(note|place|folder|project)-([0-9a-fA-F-]{36})~(${CLOCK_PATTERN.source.slice(1, -1)})\\.json$`,
);
/** Larger files are not Loam changes; reading them could exhaust memory. */
const MAX_CHANGE_BYTES = 64 * 1024 * 1024;
const MAX_LIBRARY_BYTES = 1024 * 1024;
/** Images and files a note shows; larger ones stay where they are. */
const MAX_MEDIA_BYTES = 1024 * 1024 * 1024;
/** Files read or written at once: a sync server answers each request over the network. */
const CONCURRENCY = 8;
/** Changes read and applied per step, so memory stays flat on a first sync. */
const READ_BATCH = 200;
/** Changes published per step. */
const PUBLISH_BATCH = 200;

type ChangeFile = SyncChangeRef & { path: string };

const decoder = new TextDecoder();

const fileName = ({ key, clock }: SyncChangeRef) => `${key.replace(":", "-")}~${clock}.json`;

/** Binds a sealed change to its file name, so a file can't pass for another. */
const changeContext = (name: string) => `loam-sync:${name}`;

const parseFileName = (name: string): SyncChangeRef | null => {
  const match = FILE_PATTERN.exec(name);
  if (!match) return null;
  return { key: `${match[1]}:${match[2]}` as SyncDocKey, clock: match[3]! };
};

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export class SyncFolderError extends Error {}

/**
 * The library is encrypted with a key this device doesn't use: entering its
 * passphrase or recovery key on this device makes it use that key.
 */
export class SyncFolderLockedError extends SyncFolderError {}

/** The key this device seals its notes with, and that key's locks. */
export type SyncEncryption = { key: DataKey; locks: KeyLocks } | null;

type LibraryFile = { format: number; libraryId: string; encryption?: KeyLocks };

/** One library in a sync folder or on a sync server, as one device sees it. */
export class SyncFolder {
  /** This device's file for each document, so a new version replaces the old. */
  private ownFiles: Map<SyncDocKey, string> | null = null;

  constructor(
    private readonly storage: SyncStorage,
    private readonly device: string,
    private readonly encryption: SyncEncryption = null,
  ) {
    if (!DEVICE_ID_PATTERN.test(device)) throw new Error(`Invalid device id: ${device}`);
  }

  private get deviceDirectory() {
    return `devices/${this.device}/`;
  }

  /** The names of this device's files. */
  private async listOwnFiles() {
    return (await this.storage.list(this.deviceDirectory)).map((path) =>
      path.slice(this.deviceDirectory.length),
    );
  }

  private async readLibrary(): Promise<LibraryFile | null> {
    const bytes = await this.storage.read(LIBRARY_FILE, MAX_LIBRARY_BYTES);
    if (bytes === null) return null;
    let library: Record<string, unknown>;
    try {
      library = JSON.parse(decoder.decode(bytes));
    } catch (error) {
      throw new SyncFolderError("The sync folder's library.json is damaged.", { cause: error });
    }
    if (library?.format !== LIBRARY_FORMAT.plain && library?.format !== LIBRARY_FORMAT.encrypted)
      throw new SyncFolderError(
        "This sync folder was made by a newer version of Loam. Update the app first.",
      );
    if (typeof library.libraryId !== "string")
      throw new SyncFolderError("The sync folder's library.json is damaged.");
    if (library.format === LIBRARY_FORMAT.plain)
      return { format: LIBRARY_FORMAT.plain, libraryId: library.libraryId };
    const encryption = readKeyLocks(library.encryption);
    if (!encryption) throw new SyncFolderError("The sync folder's library.json is damaged.");
    return { format: LIBRARY_FORMAT.encrypted, libraryId: library.libraryId, encryption };
  }

  private async writeLibrary(libraryId: string, locks: KeyLocks | null) {
    const library: LibraryFile = locks
      ? { format: LIBRARY_FORMAT.encrypted, libraryId, encryption: locks }
      : { format: LIBRARY_FORMAT.plain, libraryId };
    await this.storage.write(LIBRARY_FILE, JSON.stringify(library, null, 2));
  }

  /** The key locks of the library in the folder, when it is encrypted. */
  async readLocks(): Promise<KeyLocks | null> {
    return (await this.readLibrary())?.encryption ?? null;
  }

  /**
   * Reads the library's id, creating the library if the folder has none yet.
   * An encrypted device makes a plain library encrypted with its key. A
   * library encrypted with another key, or any encrypted library on a device
   * that isn't, can't be synced until this device uses its key.
   */
  async open(): Promise<{ libraryId: string }> {
    const library = await this.readLibrary();
    const encryption = this.encryption;
    if (library?.encryption && library.encryption.keyId !== encryption?.key.id)
      throw new SyncFolderLockedError(
        encryption
          ? "The notes in this sync folder are encrypted with a different passphrase. Enter it to keep syncing."
          : "The notes in this sync folder are encrypted. Enter their passphrase to sync.",
      );
    if (library && (library.encryption || !encryption)) return { libraryId: library.libraryId };
    const libraryId = library?.libraryId ?? randomUUID();
    await this.writeLibrary(libraryId, encryption?.locks ?? null);
    return { libraryId };
  }

  /** Makes the folder's library use these locks, as when a passphrase changes. */
  async updateLocks(locks: KeyLocks) {
    const library = await this.readLibrary();
    if (library?.encryption?.keyId !== locks.keyId) return;
    await this.writeLibrary(library.libraryId, locks);
  }

  /**
   * Seals this device's published files with `to`, opening them with `from`,
   * and marks the library encrypted with it. Names and clocks stay, so other
   * devices don't take them for new versions. Files already sealed with `to`
   * are left alone, so this can run again after it was interrupted.
   */
  async resealOwnFiles(from: DataKey | null, to: NonNullable<SyncEncryption>) {
    const library = await this.readLibrary();
    if (
      library?.encryption &&
      library.encryption.keyId !== to.key.id &&
      library.encryption.keyId !== from?.id
    )
      throw new SyncFolderLockedError(
        "The notes in this sync folder are encrypted with a different passphrase.",
      );
    await this.writeLibrary(library?.libraryId ?? randomUUID(), to.locks);
    const names = (await this.listOwnFiles()).filter((name) => parseFileName(name));
    await forEachConcurrently(names, CONCURRENCY, async (name) => {
      const path = this.deviceDirectory + name;
      let stored: unknown;
      try {
        const bytes = await this.storage.read(path, MAX_CHANGE_BYTES);
        if (!bytes) return;
        stored = JSON.parse(decoder.decode(bytes));
      } catch {
        return;
      }
      if (isSealedValue(stored) && stored.loamSealed === to.key.id) return;
      let change = stored;
      try {
        if (isSealedValue(stored)) change = openValue([from], stored, changeContext(name));
      } catch {
        // Sealed with a key long gone: nobody can read it, and the next change replaces it.
        return;
      }
      await this.storage.write(
        path,
        JSON.stringify(sealValue(to.key, change, changeContext(name))),
      );
    });
  }

  /** Every change file other devices have published. */
  async listChanges(): Promise<ChangeFile[]> {
    const files: ChangeFile[] = [];
    for (const path of await this.storage.list("devices/")) {
      const [, device, name, ...rest] = path.split("/");
      if (!device || !name || rest.length > 0) continue;
      if (device === this.device || !DEVICE_ID_PATTERN.test(device)) continue;
      const ref = parseFileName(name);
      // A file must hold a change by the device whose folder it is in.
      if (ref && ref.clock.endsWith(device)) files.push({ ...ref, path });
    }
    return files;
  }

  /** A change file's change, or null while it is missing, incomplete or invalid. */
  async readChange(file: ChangeFile): Promise<SyncChange | null> {
    try {
      const bytes = await this.storage.read(file.path, MAX_CHANGE_BYTES);
      if (!bytes) return null;
      const stored: unknown = JSON.parse(decoder.decode(bytes));
      // An encrypted library takes only changes sealed with its key, a plain one only plain ones.
      const key = this.encryption?.key ?? null;
      if (isSealedValue(stored) !== Boolean(key)) return null;
      const change = isSealedValue(stored)
        ? openValue([key], stored, changeContext(baseName(file.path)))
        : stored;
      return readSyncChange(change, file);
    } catch (error) {
      // A sync server that can't be reached fails the sync; it is retried as a whole.
      if (error instanceof SyncFolderError) throw error;
      return null;
    }
  }

  async publish(changes: readonly SyncChange[]) {
    const ownFiles = await this.readOwnFiles();
    // Each document appears once, so its new file and the removal of its old one never race.
    await forEachConcurrently(changes, CONCURRENCY, async (change) => {
      const name = fileName(change);
      const stored = this.encryption
        ? sealValue(this.encryption.key, change, changeContext(name))
        : change;
      await this.storage.write(this.deviceDirectory + name, JSON.stringify(stored));
      const previous = ownFiles.get(change.key);
      ownFiles.set(change.key, name);
      if (previous && previous !== name) await this.storage.remove(this.deviceDirectory + previous);
    });
  }

  /** The names of the images and files shared through sync. */
  async listMedia(): Promise<string[]> {
    return (await this.storage.list("media/"))
      .map((path) => path.slice("media/".length))
      .filter((name) => isStoredMediaName(name));
  }

  /** A shared image's bytes, or null when it is missing or too large. */
  readMedia(name: string) {
    return this.storage.read(`media/${name}`, MAX_MEDIA_BYTES);
  }

  /** Shares an image; one too large for the sync server stays on its computer. */
  async writeMedia(name: string, bytes: Uint8Array) {
    if (bytes.byteLength > this.storage.maxFileBytes) return;
    await this.storage.write(`media/${name}`, bytes);
  }

  /** Re-stores every shared image the way `convert` says; ones it returns unchanged are skipped. */
  async convertMedia(convert: (name: string, bytes: Buffer) => Uint8Array) {
    await forEachConcurrently(await this.listMedia(), CONCURRENCY, async (name) => {
      const stored = await this.readMedia(name);
      if (!stored) return;
      const bytes = Buffer.from(stored.buffer, stored.byteOffset, stored.byteLength);
      const next = convert(name, bytes);
      if (next !== bytes) await this.writeMedia(name, next);
    });
  }

  private async readOwnFiles() {
    if (!this.ownFiles) {
      this.ownFiles = new Map();
      for (const name of await this.listOwnFiles()) {
        const ref = parseFileName(name);
        if (!ref) continue;
        // Keep the newest file per document; remove older ones left by an interrupted publish.
        const kept = this.ownFiles.get(ref.key);
        const keptRef = kept ? parseFileName(kept) : null;
        if (keptRef && keptRef.clock > ref.clock) {
          await this.storage.remove(this.deviceDirectory + name);
          continue;
        }
        if (kept) await this.storage.remove(this.deviceDirectory + kept);
        this.ownFiles.set(ref.key, name);
      }
    }
    return this.ownFiles;
  }
}

type SyncRoundResult = NotesChange & {
  published: number;
  /** Change files that could not be read yet (still arriving, or damaged). */
  unreadable: number;
};

/**
 * One sync: applies what other devices published that this store lacks,
 * then publishes what changed here. Safe to stop at any point; the next
 * round picks up where this one left off.
 */
export async function syncWithFolder(store: NotesStore, folder: SyncFolder) {
  const { libraryId } = await folder.open();
  await store.prepareSync(libraryId);
  const result: SyncRoundResult = {
    changedNoteIds: [],
    deletedNoteIds: [],
    layoutChanged: false,
    conflicts: [],
    published: 0,
    unreadable: 0,
  };

  const missing = await store.selectMissingChanges(await folder.listChanges());
  // Oldest first, so a device's changes apply in the order it made them.
  missing.sort((left, right) => (left.clock < right.clock ? -1 : 1));
  for (let start = 0; start < missing.length; start += READ_BATCH) {
    const batch = missing.slice(start, start + READ_BATCH);
    const read = new Array<SyncChange | null>(batch.length);
    await forEachConcurrently([...batch.keys()], CONCURRENCY, async (index) => {
      read[index] = await folder.readChange(batch[index]!);
    });
    // Applied in clock order, whatever order the reads finished in.
    const changes = read.filter((change): change is SyncChange => change !== null);
    result.unreadable += read.length - changes.length;
    const applied = await store.applyRemoteChanges(changes);
    result.changedNoteIds.push(...applied.changedNoteIds);
    result.deletedNoteIds.push(...applied.deletedNoteIds);
    result.conflicts.push(...applied.conflicts);
    result.layoutChanged ||= applied.layoutChanged;
  }

  // A document changed again while publishing stays queued for the next round.
  let batches = Math.ceil((await store.countUnpublishedChanges()) / PUBLISH_BATCH);
  while (batches-- > 0) {
    const changes = await store.readUnpublishedChanges(PUBLISH_BATCH);
    if (changes.length === 0) break;
    await folder.publish(changes);
    await store.markChangesPublished(changes);
    result.published += changes.length;
  }
  return result;
}

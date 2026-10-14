import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { readKeyLocks, type KeyLocks } from "../encryption/keyLocks";
import { isSealedValue, openValue, sealValue, type DataKey } from "../encryption/seal";
import type { NotesChange } from "@loam/shared/notes/noteModel";

import { readIfExists, writeFileAtomic } from "../files";
import type { NotesStore } from "../NotesStore";
import { CLOCK_PATTERN, DEVICE_ID_PATTERN } from "./clock";
import { readSyncChange, type SyncChange, type SyncChangeRef, type SyncDocKey } from "./syncDocs";

/**
 * Sync through a folder a cloud drive (Dropbox, iCloud Drive, OneDrive,
 * Syncthing…) keeps in step across computers. No Loam server is involved.
 *
 *   <folder>/Loam Sync/v1/library.json         which library this is
 *   <folder>/Loam Sync/v1/devices/<device>/    one folder per device
 *     <kind>-<id>~<clock>.json                     its latest version of a document
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

const ROOT = join("Loam Sync", "v1");
const LIBRARY_FILE = "library.json";
/** 2: the library is encrypted. Older versions refuse it rather than read it wrong. */
const LIBRARY_FORMAT = { plain: 1, encrypted: 2 };
/** Versions before projects skip `project-` files: their pattern doesn't match them. */
const FILE_PATTERN = new RegExp(
  `^(note|place|folder|project)-([0-9a-fA-F-]{36})~(${CLOCK_PATTERN.source.slice(1, -1)})\\.json$`,
);
/** Larger files are not Loam changes; reading them could exhaust memory. */
const MAX_CHANGE_BYTES = 64 * 1024 * 1024;
/** Changes read and applied per step, so memory stays flat on a first sync. */
const READ_BATCH = 200;
/** Changes published per step. */
const PUBLISH_BATCH = 200;

type ChangeFile = SyncChangeRef & { path: string };

const fileName = ({ key, clock }: SyncChangeRef) => `${key.replace(":", "-")}~${clock}.json`;

/** Binds a sealed change to its file name, so a file can't pass for another. */
const changeContext = (name: string) => `loam-sync:${name}`;

const parseFileName = (name: string): SyncChangeRef | null => {
  const match = FILE_PATTERN.exec(name);
  if (!match) return null;
  return { key: `${match[1]}:${match[2]}` as SyncDocKey, clock: match[3]! };
};

const readDirectory = async (path: string) => (await readIfExists(readdir(path))) ?? [];

export class SyncFolderError extends Error {}

/**
 * The library is encrypted with a key this device doesn't use: entering its
 * passphrase or recovery key on this device makes it use that key.
 */
export class SyncFolderLockedError extends SyncFolderError {}

/** The key this device seals its notes with, and that key's locks. */
export type SyncEncryption = { key: DataKey; locks: KeyLocks } | null;

type LibraryFile = { format: number; libraryId: string; encryption?: KeyLocks };

/** One library in a sync folder, as one device sees it. */
export class SyncFolder {
  readonly root: string;
  /** This device's file for each document, so a new version replaces the old. */
  private ownFiles: Map<SyncDocKey, string> | null = null;

  constructor(
    folder: string,
    private readonly device: string,
    private readonly encryption: SyncEncryption = null,
  ) {
    if (!DEVICE_ID_PATTERN.test(device)) throw new Error(`Invalid device id: ${device}`);
    this.root = join(folder, ROOT);
  }

  private get deviceDirectory() {
    return join(this.root, "devices", this.device);
  }

  private async readLibrary(): Promise<LibraryFile | null> {
    const text = await readIfExists(readFile(join(this.root, LIBRARY_FILE), "utf8"));
    if (text === null) return null;
    let library: Record<string, unknown>;
    try {
      library = JSON.parse(text);
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
    await mkdir(this.root, { recursive: true });
    await writeFileAtomic(join(this.root, LIBRARY_FILE), JSON.stringify(library, null, 2));
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
    await mkdir(this.deviceDirectory, { recursive: true });
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
    for (const name of await readDirectory(this.deviceDirectory)) {
      if (!parseFileName(name)) continue;
      const path = join(this.deviceDirectory, name);
      let stored: unknown;
      try {
        stored = JSON.parse(await readFile(path, "utf8"));
      } catch {
        continue;
      }
      if (isSealedValue(stored) && stored.loamSealed === to.key.id) continue;
      let change = stored;
      try {
        if (isSealedValue(stored)) change = openValue([from], stored, changeContext(name));
      } catch {
        // Sealed with a key long gone: nobody can read it, and the next change replaces it.
        continue;
      }
      await writeFileAtomic(path, JSON.stringify(sealValue(to.key, change, changeContext(name))));
    }
  }

  /** Every change file other devices have published. */
  async listChanges(): Promise<ChangeFile[]> {
    const files: ChangeFile[] = [];
    for (const device of await readDirectory(join(this.root, "devices"))) {
      if (device === this.device || !DEVICE_ID_PATTERN.test(device)) continue;
      const directory = join(this.root, "devices", device);
      for (const name of await readDirectory(directory)) {
        const ref = parseFileName(name);
        // A file must hold a change by the device whose folder it is in.
        if (ref && ref.clock.endsWith(device)) files.push({ ...ref, path: join(directory, name) });
      }
    }
    return files;
  }

  /** A change file's change, or null while it is missing, incomplete or invalid. */
  async readChange(file: ChangeFile): Promise<SyncChange | null> {
    try {
      if ((await stat(file.path)).size > MAX_CHANGE_BYTES) return null;
      const stored: unknown = JSON.parse(await readFile(file.path, "utf8"));
      // An encrypted library takes only changes sealed with its key, a plain one only plain ones.
      const key = this.encryption?.key ?? null;
      if (isSealedValue(stored) !== Boolean(key)) return null;
      const change = isSealedValue(stored)
        ? openValue([key], stored, changeContext(basename(file.path)))
        : stored;
      return readSyncChange(change, file);
    } catch {
      return null;
    }
  }

  async publish(changes: readonly SyncChange[]) {
    const ownFiles = await this.readOwnFiles();
    for (const change of changes) {
      const name = fileName(change);
      const stored = this.encryption
        ? sealValue(this.encryption.key, change, changeContext(name))
        : change;
      await writeFileAtomic(join(this.deviceDirectory, name), JSON.stringify(stored));
      const previous = ownFiles.get(change.key);
      if (previous && previous !== name)
        await rm(join(this.deviceDirectory, previous), { force: true });
      ownFiles.set(change.key, name);
    }
  }

  private async readOwnFiles() {
    if (!this.ownFiles) {
      this.ownFiles = new Map();
      for (const name of await readDirectory(this.deviceDirectory)) {
        const ref = parseFileName(name);
        if (!ref) continue;
        // Keep the newest file per document; remove older ones left by an interrupted publish.
        const kept = this.ownFiles.get(ref.key);
        const keptRef = kept ? parseFileName(kept) : null;
        if (keptRef && keptRef.clock > ref.clock) {
          await rm(join(this.deviceDirectory, name), { force: true });
          continue;
        }
        if (kept) await rm(join(this.deviceDirectory, kept), { force: true });
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
    conflictCopies: [],
    published: 0,
    unreadable: 0,
  };

  const missing = await store.selectMissingChanges(await folder.listChanges());
  // Oldest first, so a device's changes apply in the order it made them.
  missing.sort((left, right) => (left.clock < right.clock ? -1 : 1));
  for (let start = 0; start < missing.length; start += READ_BATCH) {
    const changes: SyncChange[] = [];
    for (const file of missing.slice(start, start + READ_BATCH)) {
      const change = await folder.readChange(file);
      if (change) changes.push(change);
      else result.unreadable += 1;
    }
    const applied = await store.applyRemoteChanges(changes);
    result.changedNoteIds.push(...applied.changedNoteIds);
    result.deletedNoteIds.push(...applied.deletedNoteIds);
    result.conflictCopies.push(...applied.conflictCopies);
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

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createMemoryStorageAdapter } from "../adapters/memoryAdapter";
import { convertStoredRecords, withEncryption } from "../encryption/encryptedAdapter";
import { createRecoveryKey, lockDataKey, type KeyLocks } from "../encryption/keyLocks";
import { createDataKey, type DataKey } from "../encryption/seal";
import type { NotesStore } from "../NotesStore";
import {
  SyncFolder,
  SyncFolderLockedError,
  syncWithFolder,
  type SyncEncryption,
} from "../sync/syncFolder";
import { createNote, createTestStore, noteId } from "../testing/storeFixtures";
import { createTempDirectories } from "../testing/tempDirectories";

const A = noteId(1);
const B = noteId(2);
const SECRET = "Tangerine";

const tempDirectory = createTempDirectories("loam-sync-encrypted-");
let folder: string;
let encryption: NonNullable<SyncEncryption>;

beforeAll(async () => {
  const key = createDataKey();
  encryption = {
    key,
    locks: await lockDataKey(key, { passphrase: "pass", recoveryKey: createRecoveryKey() }),
  };
});

beforeEach(() => {
  folder = tempDirectory();
});

type Device = {
  store: NotesStore;
  inner: ReturnType<typeof createMemoryStorageAdapter>;
  device: string;
  sync: () => ReturnType<typeof syncWithFolder>;
};

const createDevice = async (keys: SyncEncryption = null): Promise<Device> => {
  const inner = createMemoryStorageAdapter();
  const store = await createTestStore(withEncryption(inner, keys?.key ?? null));
  const device = await store.readSyncDevice();
  return {
    store,
    inner,
    device,
    sync: () => syncWithFolder(store, new SyncFolder(folder, device, keys)),
  };
};

/** Every file in the sync folder, as text. */
const folderText = async () => {
  const root = join(folder, "Loam Sync", "v1");
  const texts: string[] = [await readFile(join(root, "library.json"), "utf8")];
  for (const device of await readdir(join(root, "devices")))
    for (const name of await readdir(join(root, "devices", device)))
      texts.push(await readFile(join(root, "devices", device, name), "utf8"));
  return texts.join("\n");
};

const titles = async (store: NotesStore) =>
  (await store.getLibrary()).notes.map((note) => note.title).sort();

/** What turning encryption on does to a device's store and its files in the folder. */
const encryptDevice = async (device: Device, from: DataKey | null, to: typeof encryption) => {
  await device.store.replaceAdapter(async () => {
    await convertStoredRecords(device.inner, { from, to: to.key });
    return withEncryption(device.inner, to.key);
  });
  await new SyncFolder(folder, device.device, to).resealOwnFiles(from, to);
  device.sync = () => syncWithFolder(device.store, new SyncFolder(folder, device.device, to));
};

describe("encrypted sync", () => {
  it("syncs between devices with the key and keeps the folder unreadable", async () => {
    const one = await createDevice(encryption);
    const two = await createDevice(encryption);
    await createNote(one.store, A, { title: `${SECRET} plans` });
    await one.sync();
    await two.sync();
    expect(await titles(two.store)).toEqual([`${SECRET} plans`]);
    const text = await folderText();
    expect(text).not.toContain(SECRET);
    const library = await readFile(join(folder, "Loam Sync", "v1", "library.json"), "utf8");
    expect(JSON.parse(library)).toMatchObject({
      format: 2,
      encryption: { keyId: encryption.key.id },
    });
  });

  it("pauses a device without the key, or with another, until it uses the library's key", async () => {
    const one = await createDevice(encryption);
    await createNote(one.store, A, { title: "From one" });
    await one.sync();

    const plain = await createDevice();
    await createNote(plain.store, B, { title: "From plain" });
    await expect(plain.sync()).rejects.toBeInstanceOf(SyncFolderLockedError);
    const otherKey = createDataKey();
    const other = await createDevice({
      key: otherKey,
      locks: { ...encryption.locks, keyId: otherKey.id } as KeyLocks,
    });
    await expect(other.sync()).rejects.toThrow("different passphrase");

    // The folder's locks are what a device needs to unlock with its passphrase.
    expect(await new SyncFolder(folder, plain.device).readLocks()).toEqual(encryption.locks);
    await encryptDevice(plain, null, encryption);
    await plain.sync();
    await one.sync();
    expect(await titles(plain.store)).toEqual(["From one", "From plain"]);
    expect(await titles(one.store)).toEqual(["From one", "From plain"]);
  });

  it("encrypts a plain library in place: resealed files keep their names, so nothing re-applies", async () => {
    const one = await createDevice();
    const two = await createDevice();
    await createNote(one.store, A, { title: `${SECRET} one` });
    await createNote(two.store, B, { title: "Two" });
    for (const device of [one, two, one]) await device.sync();
    const namesBefore = await readdir(join(folder, "Loam Sync", "v1", "devices", one.device));

    await encryptDevice(one, null, encryption);
    expect(await readdir(join(folder, "Loam Sync", "v1", "devices", one.device))).toEqual(
      namesBefore,
    );
    // Two still has plain files there; it is paused until it takes the key.
    await expect(two.sync()).rejects.toBeInstanceOf(SyncFolderLockedError);
    const quiet = await one.sync();
    expect(quiet).toMatchObject({ changedNoteIds: [], published: 0 });

    await encryptDevice(two, null, encryption);
    expect(await two.sync()).toMatchObject({ changedNoteIds: [], published: 0, unreadable: 0 });
    expect(await one.sync()).toMatchObject({ changedNoteIds: [], unreadable: 0 });
    expect(await folderText()).not.toContain(SECRET);

    await one.store.saveNote(A, { title: "Edited after" });
    await one.sync();
    await two.sync();
    expect(await titles(two.store)).toEqual(["Edited after", "Two"]);
  });

  it("skips a sealed change file that was tampered with", async () => {
    const one = await createDevice(encryption);
    const two = await createDevice(encryption);
    await createNote(one.store, A, { title: "Original" });
    await one.sync();
    const directory = join(folder, "Loam Sync", "v1", "devices", one.device);
    const [name] = (await readdir(directory)).filter((file) => file.startsWith("note-"));
    const sealed = JSON.parse(await readFile(join(directory, name!), "utf8"));
    const bytes = Buffer.from(sealed.data, "base64");
    bytes[20]! ^= 1;
    await writeFile(
      join(directory, name!),
      JSON.stringify({ ...sealed, data: bytes.toString("base64") }),
    );
    expect((await two.sync()).unreadable).toBe(1);
    expect((await two.store.getLibrary()).notes).toEqual([]);
  });
});

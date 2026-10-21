import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BridgeSyncStatus } from "@loam/shared/bridge/loamBridge";
import { createNote, newNote, noteId } from "@loam/storage/testing/storeFixtures";
import { createDataKey } from "@loam/storage/encryption/seal";
import { createTempDirectories } from "@loam/storage/testing/tempDirectories";

import { loadEncryption, type EncryptionManager } from "../encryption/encryption";
import { openLibrary } from "../library";
import { createMediaStore, mediaConverter } from "../mediaStore";
import { fakeSecrets } from "./fakeSecrets";

const SECRET = "Tangerine";
const PASSPHRASE = "correct horse battery";
const PNG = Buffer.from(`\x89PNG\r\n\x1a\n${SECRET} pixels`, "binary");
const TIMING = {
  afterChangeMs: 10_000,
  maxWaitMs: 10_000,
  pollMs: 60_000,
  retryMs: 50,
  maxRetryMs: 50,
};

const tempRoot = createTempDirectories("loam-encryption-app-");
const opened: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  for (const library of opened.splice(0)) await library.close();
});

/** One computer: its data folder, opened the way the app opens it. */
const openComputer = async (dataDirectory: string) => {
  const encryption = await loadEncryption(dataDirectory);
  const statuses: BridgeSyncStatus[] = [];
  const open = async () => {
    const library = await openLibrary({
      dataDirectory,
      encryption,
      appVersion: "0.1.0",
      onSyncStatus: (status) => statuses.push(status),
      onNotesChange: () => undefined,
      onRestored: () => undefined,
      onLinkedFileChange: () => undefined,
      secrets: fakeSecrets,
      syncTiming: TIMING,
    });
    opened.push({ close: () => library.close() });
    return library;
  };
  return { encryption, open, statuses };
};

type Library = Awaited<ReturnType<Awaited<ReturnType<typeof openComputer>>["open"]>>;

const seedLibrary = async (library: Library) => {
  await createNote(library.store, noteId(1), { title: `${SECRET} plans` });
  await library.store.createNote(newNote(noteId(2), { title: "Second" }));
  const image = await library.media.saveImage(new Uint8Array(PNG));
  return image.path;
};

/** Every byte under `directory`, with backups unzipped. */
const allBytes = (directory: string): Buffer =>
  Buffer.concat(
    readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const bytes = readFileSync(join(entry.parentPath, entry.name));
        return entry.name.endsWith(".gz") ? gunzipSync(bytes) : bytes;
      }),
  );

const showImage = async (library: Library, name: string) => {
  const response = await library.media.handleRequest(new Request(`loam-media://images/${name}`));
  return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
};

const titles = async (library: Library) =>
  (await library.store.getLibrary()).notes.map((note) => note.title).sort();

const parts = (library: Library) => library.parts;

const enable = async (encryption: EncryptionManager, library: Library) => {
  const recoveryKey = encryption.newRecoveryKey();
  await encryption.enable(parts(library), PASSPHRASE, recoveryKey);
  return recoveryKey;
};

describe("encryption", () => {
  it("encrypts a library with notes, images, backups and a sync folder, and opens it only with the passphrase", async () => {
    const root = tempRoot();
    const data = join(root, "data");
    const shared = join(root, "Dropbox");
    mkdirSync(shared);
    const computer = await openComputer(data);
    const library = await computer.open();
    const image = await seedLibrary(library);
    await library.backups.create("manual");
    await library.sync.useFolder(shared);
    expect(allBytes(data).includes(SECRET)).toBe(true);
    expect(allBytes(shared).includes(SECRET)).toBe(true);

    // A passphrase that is too short is refused before anything changes.
    const shown = computer.encryption.newRecoveryKey();
    await expect(computer.encryption.enable(parts(library), "short", shown)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    const recoveryKey = await enable(computer.encryption, library);
    expect(computer.encryption.status()).toEqual({ state: "on" });
    expect(await titles(library)).toEqual(["Second", `${SECRET} plans`]);
    expect(await showImage(library, image)).toEqual(PNG);
    // Searching works without the database's text index.
    expect((await library.store.searchNotes("tangerine")).results).toHaveLength(1);

    // Nothing readable is left: database, images, backups (including the one
    // taken just before), nor the sync folder.
    expect(allBytes(data).includes(SECRET)).toBe(false);
    expect(allBytes(shared).includes(SECRET)).toBe(false);
    const backups = await library.backups.list();
    expect(backups.map((backup) => backup.kind).sort()).toEqual(["before-encryption", "manual"]);

    // Edits and new images after that are sealed too.
    await library.store.saveNote(noteId(2), { title: `${SECRET} two` });
    const later = await library.media.saveImage(new Uint8Array(PNG));
    await library.backups.create("manual");
    await library.sync.syncNow();
    expect(allBytes(data).includes(SECRET)).toBe(false);
    expect(allBytes(shared).includes(SECRET)).toBe(false);
    expect(await showImage(library, later.path)).toEqual(PNG);

    // A plain image put in the sync folder arrives, but isn't shown.
    const planted = "11111111-2222-4333-8444-555555555555.png";
    writeFileSync(join(shared, "Loam Sync", "v1", "media", planted), PNG);
    await library.sync.syncNow();
    expect(readdirSync(join(data, "media"))).toContain(planted);
    expect(await showImage(library, planted)).toBeNull();

    // Next launch: locked until the passphrase is entered.
    await opened.pop()!.close();
    const relaunched = await openComputer(data);
    expect(relaunched.encryption.status()).toEqual({ state: "locked" });
    await expect(relaunched.encryption.unlock("wrong passphrase")).rejects.toMatchObject({
      code: "WRONG_PASSPHRASE",
    });
    await relaunched.encryption.unlock(PASSPHRASE);
    const reopened = await relaunched.open();
    expect(await titles(reopened)).toEqual([`${SECRET} plans`, `${SECRET} two`]);
    expect(await showImage(reopened, image)).toEqual(PNG);

    // A forgotten passphrase: the recovery key unlocks and sets a new one.
    await opened.pop()!.close();
    const forgotten = await openComputer(data);
    await expect(
      forgotten.encryption.resetPassphrase("AAAA-BBBB", "new passphrase"),
    ).rejects.toMatchObject({ code: "WRONG_PASSPHRASE" });
    await forgotten.encryption.resetPassphrase(recoveryKey, "new passphrase");
    await forgotten.open();
    const afterReset = await openComputer(data);
    await expect(afterReset.encryption.unlock(PASSPHRASE)).rejects.toMatchObject({
      code: "WRONG_PASSPHRASE",
    });
    await afterReset.encryption.unlock("new passphrase");
  });

  it("turns encryption off again, and restores an encrypted backup with its passphrase", async () => {
    const root = tempRoot();
    const data = join(root, "data");
    const shared = join(root, "Dropbox");
    mkdirSync(shared);
    const computer = await openComputer(data);
    const library = await computer.open();
    const image = await seedLibrary(library);
    await enable(computer.encryption, library);
    await library.sync.useFolder(shared);
    const [encryptedBackup] = await library.backups.list();

    await expect(computer.encryption.disable(parts(library), "wrong")).rejects.toMatchObject({
      code: "WRONG_PASSPHRASE",
    });
    await computer.encryption.disable(parts(library), PASSPHRASE);
    expect(computer.encryption.status()).toEqual({ state: "off" });
    expect(existsSync(join(data, "encryption.json"))).toBe(false);
    // Sync is turned off: the folder stays encrypted for the other computers.
    expect(library.sync.isOn()).toBe(false);
    expect(allBytes(shared).includes(SECRET)).toBe(false);
    expect(readFileSync(join(data, "media", image)).equals(PNG)).toBe(true);
    expect((await library.store.searchNotes(SECRET)).results).toHaveLength(1);

    // The encrypted backups stay encrypted, and open with that passphrase.
    await library.store.deleteNote(noteId(1));
    rmSync(join(data, "media", image));
    await expect(library.backups.restore({ id: encryptedBackup!.id })).rejects.toMatchObject({
      code: "BACKUP_LOCKED",
    });
    await expect(
      library.backups.restore({ id: encryptedBackup!.id }, "wrong"),
    ).rejects.toMatchObject({ code: "BACKUP_LOCKED" });
    await library.backups.restore({ id: encryptedBackup!.id }, PASSPHRASE);
    expect(await titles(library)).toEqual(["Second", `${SECRET} plans`]);
    // Its images come back plain, as this library keeps them now.
    expect(readFileSync(join(data, "media", image)).equals(PNG)).toBe(true);
  });

  it("saves the recovery key only its owner can read, replacing a file only when asked", async () => {
    const root = tempRoot();
    const { encryption } = await openComputer(join(root, "data"));
    const path = join(root, "recovery key.txt");
    await expect(encryption.saveRecoveryKey(path, { replace: true })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    const recoveryKey = encryption.newRecoveryKey();
    writeFileSync(path, "an older file", { mode: 0o644 });
    await expect(encryption.saveRecoveryKey(path, { replace: false })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(readFileSync(path, "utf8")).toBe("an older file");
    await encryption.saveRecoveryKey(path, { replace: true });
    expect(readFileSync(path, "utf8")).toContain(recoveryKey);
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("encrypts only with the recovery key shown, and blocks a store whose conversion failed", async () => {
    const root = tempRoot();
    const data = join(root, "data");
    const computer = await openComputer(data);
    const library = await computer.open();
    await seedLibrary(library);
    const shown = computer.encryption.newRecoveryKey();
    computer.encryption.newRecoveryKey();
    await expect(
      computer.encryption.enable(parts(library), PASSPHRASE, shown),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    // The records fail to convert part way: nothing may read or write them until a restart.
    const latest = computer.encryption.newRecoveryKey();
    const commit = library.parts.inner.commit.bind(library.parts.inner);
    let commits = 0;
    library.parts.inner.commit = async (writes) => {
      if (++commits === 2) throw new Error("disk full");
      return commit(writes);
    };
    await expect(
      computer.encryption.enable(parts(library), PASSPHRASE, latest),
    ).rejects.toMatchObject({ code: "ENCRYPTION_INCOMPLETE" });
    library.parts.inner.commit = commit;
    await expect(library.store.getLibrary()).rejects.toMatchObject({
      code: "ENCRYPTION_INCOMPLETE",
    });
    await expect(
      computer.encryption.enable(parts(library), PASSPHRASE, latest),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    opened.pop();
    await library.sync.stop();

    const relaunched = await openComputer(data);
    await relaunched.encryption.unlock(PASSPHRASE);
    const reopened = await relaunched.open();
    expect(await titles(reopened)).toEqual(["Second", `${SECRET} plans`]);
    expect(allBytes(data).includes(SECRET)).toBe(false);
  });

  it("finishes turning encryption on after a crash part way, even when the sync folder can't be reached, and publishes everything again", async () => {
    const root = tempRoot();
    const data = join(root, "data");
    const shared = join(root, "Dropbox");
    mkdirSync(shared);
    const computer = await openComputer(data);
    const library = await computer.open();
    await seedLibrary(library);
    await library.backups.create("manual");
    await library.sync.useFolder(shared);
    const seal = vi
      .spyOn(library.backups, "sealPlainBackups")
      .mockRejectedValueOnce(new Error("crash"));
    const recoveryKey = computer.encryption.newRecoveryKey();
    await expect(
      computer.encryption.enable(parts(library), PASSPHRASE, recoveryKey),
    ).rejects.toMatchObject({ code: "ENCRYPTION_INCOMPLETE" });
    seal.mockRestore();
    expect(allBytes(join(data, "backups")).includes(SECRET)).toBe(true);
    await opened.pop()!.close();

    // The cloud drive is gone at the next launch.
    rmSync(shared, { recursive: true });
    writeFileSync(shared, "not a folder");
    const relaunched = await openComputer(data);
    expect(relaunched.encryption.status()).toEqual({ state: "locked" });
    await relaunched.encryption.unlock(PASSPHRASE);
    const reopened = await relaunched.open();
    expect(await titles(reopened)).toEqual(["Second", `${SECRET} plans`]);
    expect(allBytes(data).includes(SECRET)).toBe(false);
    expect(JSON.parse(readFileSync(join(data, "encryption.json"), "utf8"))).not.toHaveProperty(
      "converting",
    );
    expect(await reopened.store.countUnpublishedChanges()).toBe(0);
    rmSync(shared);
    mkdirSync(shared);
    await reopened.sync.syncNow();
    expect(allBytes(shared).includes(SECRET)).toBe(false);
    expect(readdirSync(join(shared, "Loam Sync", "v1", "devices")).length).toBe(1);
  });

  it("lets a second computer join an encrypted sync folder with its passphrase", async () => {
    const root = tempRoot();
    const shared = join(root, "Dropbox");
    mkdirSync(shared);
    const one = await openComputer(join(root, "one"));
    const first = await one.open();
    await seedLibrary(first);
    await enable(one.encryption, first);
    await first.sync.useFolder(shared);

    const two = await openComputer(join(root, "two"));
    const second = await two.open();
    await second.store.createNote(newNote(noteId(3), { title: "From two" }));
    const status = await second.sync.useFolder(shared);
    expect(status).toMatchObject({ state: "error", needsPassphrase: true });
    // Turning encryption on with a new passphrase would split the library.
    const shown = two.encryption.newRecoveryKey();
    await expect(
      two.encryption.enable(parts(second), "another passphrase", shown),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });

    await expect(two.encryption.adoptSyncFolderKey(parts(second), "wrong")).rejects.toMatchObject({
      code: "WRONG_PASSPHRASE",
    });
    await two.encryption.adoptSyncFolderKey(parts(second), PASSPHRASE);
    expect(two.encryption.status()).toEqual({ state: "on" });
    expect(await second.sync.syncNow()).toMatchObject({ state: "synced", needsPassphrase: false });
    await first.sync.syncNow();
    expect(await titles(first)).toEqual(["From two", "Second", `${SECRET} plans`]);
    expect(await titles(second)).toEqual(["From two", "Second", `${SECRET} plans`]);
    expect(allBytes(join(root, "two")).includes(SECRET)).toBe(false);

    // A new passphrase on one computer is the one a computer joining later uses.
    await one.encryption.changePassphrase(parts(first), PASSPHRASE, "changed passphrase");
    const three = await openComputer(join(root, "three"));
    const third = await three.open();
    await third.sync.useFolder(shared);
    await expect(three.encryption.adoptSyncFolderKey(parts(third), PASSPHRASE)).rejects.toThrow();
    await three.encryption.adoptSyncFolderKey(parts(third), "changed passphrase");
    await third.sync.syncNow();
    expect(await titles(third)).toEqual(["From two", "Second", `${SECRET} plans`]);
  });

  it("treats a plain or changed image in an encrypted library as missing", async () => {
    const directory = tempRoot();
    const key = createDataKey();
    const media = createMediaStore(directory, () => ({ seal: key, open: [key] }));
    // A plain file dropped into the media folder, or arriving from a sync folder.
    const plain = "11111111-2222-4333-8444-555555555555.png";
    writeFileSync(join(directory, plain), PNG);
    expect(mediaConverter({ seal: key, open: [key] })(plain, PNG)).toBe(PNG);
    const sealed = (await media.saveImage(new Uint8Array(PNG))).path;
    const show = (name: string) => media.handleRequest(new Request(`loam-media://images/${name}`));
    expect((await show(plain)).status).toBe(404);
    await expect(media.readImage(plain)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(Buffer.from(await (await show(sealed)).arrayBuffer())).toEqual(PNG);
    const bytes = readFileSync(join(directory, sealed));
    bytes[bytes.length - 1]! ^= 1;
    writeFileSync(join(directory, sealed), bytes);
    expect((await show(sealed)).status).toBe(404);
  });
});

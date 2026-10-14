import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMemoryStorageAdapter } from "../adapters/memoryAdapter";
import { createSqliteStorageAdapter } from "../adapters/sqliteAdapter";
import type { StorageAdapter } from "../adapter";
import {
  convertStoredRecords,
  encryptStorageAdapter,
  withEncryption,
} from "../encryption/encryptedAdapter";
import {
  changePassphrase,
  createRecoveryKey,
  lockDataKey,
  parseRecoveryKey,
  readKeyLocks,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  unlockWithSecret,
} from "../encryption/keyLocks";
import {
  createDataKey,
  openDataKey,
  openFile,
  sealDataKey,
  sealedFileKeyId,
  sealFile,
  SealError,
} from "../encryption/seal";
import { NotesStore } from "../NotesStore";
import {
  bodyPatch,
  createClock,
  createNote,
  createTestStore,
  noteId,
  paragraph,
  text,
} from "../testing/storeFixtures";
import { createTempDirectories } from "../testing/tempDirectories";

const tempDirectory = createTempDirectories("loam-encryption-");

/** Every byte SQLite keeps for a database: the file and its write-ahead log. */
const databaseBytes = (directory: string) =>
  Buffer.concat(
    readdirSync(directory)
      .filter((name) => name.startsWith("notes.sqlite"))
      .map((name) => readFileSync(join(directory, name))),
  );

const SECRET = "Tangerine";

describe("data keys", () => {
  it("unlocks with the passphrase or the recovery key, and not with anything else", async () => {
    const key = createDataKey();
    const recoveryKey = createRecoveryKey();
    expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    const locks = await lockDataKey(key, { passphrase: "correct horse", recoveryKey });

    expect((await unlockWithPassphrase(locks, "correct horse"))?.bytes).toEqual(key.bytes);
    expect(await unlockWithPassphrase(locks, "correct hors")).toBeNull();
    // Recovery keys are forgiving about case, spaces and look-alike letters.
    const retyped = recoveryKey.toLowerCase().replace(/-/g, " ").replace(/0/g, "o");
    expect((await unlockWithRecoveryKey(locks, retyped))?.bytes).toEqual(key.bytes);
    expect(await unlockWithRecoveryKey(locks, createRecoveryKey())).toBeNull();
    expect(await unlockWithRecoveryKey(locks, "not a key")).toBeNull();
    expect((await unlockWithSecret(locks, recoveryKey))?.id).toBe(key.id);
    expect((await unlockWithSecret(locks, "correct horse"))?.id).toBe(key.id);

    // A new passphrase replaces the old one; the recovery key still works.
    const changed = await changePassphrase(locks, key, "new words");
    expect(await unlockWithPassphrase(changed, "correct horse")).toBeNull();
    expect((await unlockWithPassphrase(changed, "new words"))?.bytes).toEqual(key.bytes);
    expect((await unlockWithRecoveryKey(changed, recoveryKey))?.bytes).toEqual(key.bytes);

    // Locks read from a file are checked; an absurd scrypt cost is refused.
    expect(readKeyLocks(JSON.parse(JSON.stringify(locks)))).toEqual(locks);
    expect(readKeyLocks({ ...locks, passphrase: { ...locks.passphrase, N: 2 ** 30 } })).toBeNull();
    expect(readKeyLocks({ ...locks, keyId: "x" })).toBeNull();
  });

  it("parses only well-formed recovery keys", () => {
    expect(parseRecoveryKey(createRecoveryKey())?.length).toBe(20);
    expect(parseRecoveryKey("ABCD")).toBeNull();
    expect(parseRecoveryKey("U".repeat(32))).toBeNull();
  });

  it("seals files and keys so that only the right key, in the right place, opens them", () => {
    const key = createDataKey();
    const other = createDataKey();
    const sealed = sealFile(key, Buffer.from("picture"), "a.png");
    expect(sealedFileKeyId(sealed)).toBe(key.id);
    expect(openFile([other, key], sealed, "a.png").toString()).toBe("picture");
    expect(() => openFile([key], sealed, "b.png")).toThrow(SealError);
    expect(() => openFile([other], sealed, "a.png")).toThrow(SealError);
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 20]! ^= 1;
    expect(() => openFile([key], tampered, "a.png")).toThrow(SealError);

    expect(openDataKey(sealDataKey(other, key), key, other.id).bytes).toEqual(other.bytes);
    expect(() => openDataKey(sealDataKey(other, key), other, other.id)).toThrow(SealError);
  });

  it("opens a plain file only when no key is one of the accepted ones", () => {
    const key = createDataKey();
    const plain = Buffer.from("plain");
    expect(sealedFileKeyId(plain)).toBeNull();
    expect(openFile([null], plain, "a.png").toString()).toBe("plain");
    expect(openFile([key, null], plain, "a.png").toString()).toBe("plain");
    expect(() => openFile([key], plain, "a.png")).toThrow(SealError);
    expect(() => openFile([], plain, "a.png")).toThrow(SealError);
  });

  it("refuses a sealed data key of the wrong length", () => {
    const under = createDataKey();
    const short = { id: randomUUID(), bytes: Buffer.alloc(16) };
    expect(() => openDataKey(sealDataKey(short, under), under, short.id)).toThrow(SealError);
  });
});

const adapters: Array<[string, (directory: string) => StorageAdapter]> = [
  ["memory", () => createMemoryStorageAdapter()],
  ["sqlite", (directory) => createSqliteStorageAdapter(join(directory, "notes.sqlite"))],
];

describe.each(adapters)("encrypted %s storage", (_name, createAdapter) => {
  it("stores notes the backend can't read, and refuses records that were changed", async () => {
    const directory = tempDirectory();
    const inner = createAdapter(directory);
    const key = createDataKey();
    const store = await createTestStore(encryptStorageAdapter(inner, key));
    await createNote(store, noteId(1), {
      title: "Tangerine plans",
      blocks: [paragraph(text("Meet at the café"))],
    });

    const raw = await inner.get("notes", noteId(1));
    expect(JSON.stringify(raw)).not.toContain(SECRET);
    expect(raw?.value).toEqual({ loamSealed: key.id, data: expect.any(String) });
    expect((await store.getNote(noteId(1))).title).toBe("Tangerine plans");

    // Search runs in memory: every word, any case, accents ignored.
    expect((await store.searchNotes("tangerine CAFE")).results.map((r) => r.noteId)).toEqual([
      noteId(1),
    ]);
    expect((await store.searchNotes("tangerine bus")).results).toEqual([]);

    // A record moved under another id no longer opens.
    const document = await inner.get("documents", noteId(1));
    await inner.commit([
      { type: "put", collection: "documents", id: noteId(2), value: document!.value },
    ]);
    const reopened = encryptStorageAdapter(inner, key);
    await expect(reopened.get("documents", noteId(2))).rejects.toMatchObject({
      code: "DECRYPT_FAILED",
    });
    // So does a record opened with another key, or one that isn't sealed.
    await expect(
      encryptStorageAdapter(inner, createDataKey()).get("documents", noteId(1)),
    ).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
    await inner.commit([{ type: "put", collection: "meta", id: "planted", value: { x: 1 } }]);
    await expect(reopened.get("meta", "planted")).rejects.toMatchObject({
      code: "DECRYPT_FAILED",
    });
    await store.close();
  });
});

describe("turning encryption on and off", () => {
  const seed = async (store: NotesStore) => {
    for (let index = 1; index <= 30; index += 1)
      await createNote(store, noteId(index), {
        title: `${SECRET} ${index}`,
        blocks: [paragraph(text(`secret body ${index}`))],
      });
    // Saved twice ten minutes apart, so history holds a version too.
    await store.saveNote(noteId(1), bodyPatch(paragraph(text(`${SECRET} again`))));
  };

  const contents = async (store: NotesStore) => ({
    library: await store.getLibrary(),
    notes: await Promise.all(
      (await store.getLibrary()).notes.map((note) => store.getNote(note.id)),
    ),
    history: await store.getNoteHistory(noteId(1)),
  });

  it("encrypts an existing SQLite library in place and leaves no plain text behind", async () => {
    const directory = tempDirectory();
    const inner = createSqliteStorageAdapter(join(directory, "notes.sqlite"));
    const clock = createClock();
    const store = await createTestStore(inner, clock);
    await seed(store);
    const before = await contents(store);
    expect(databaseBytes(directory).includes(SECRET)).toBe(true);

    const key = createDataKey();
    await store.replaceAdapter(async () => {
      await convertStoredRecords(inner, { from: null, to: key });
      return withEncryption(inner, key);
    });
    expect(await contents(store)).toEqual(before);
    expect(databaseBytes(directory).includes(SECRET)).toBe(false);
    expect(databaseBytes(directory).includes("secret body")).toBe(false);
    // Nor the search index's own copy of the words, which it keeps in lower case.
    expect(databaseBytes(directory).includes(SECRET.toLowerCase())).toBe(false);
    // Edits carry on, sealed.
    await store.saveNote(noteId(2), { title: "Renamed" });
    expect((await store.searchNotes("renamed")).results).toHaveLength(1);
    await store.close();

    // Opened again with the key, everything is there; and back to plain.
    const second = createSqliteStorageAdapter(join(directory, "notes.sqlite"));
    const reopened = await NotesStore.open({ adapter: withEncryption(second, key), now: clock });
    expect((await reopened.getNote(noteId(2))).title).toBe("Renamed");
    await reopened.replaceAdapter(async () => {
      await convertStoredRecords(second, { from: key, to: null });
      return second;
    });
    expect((await reopened.getNote(noteId(2))).title).toBe("Renamed");
    // The SQLite text index is back.
    expect((await reopened.searchNotes(SECRET)).results.length).toBeGreaterThan(0);
    expect(databaseBytes(directory).includes(SECRET)).toBe(true);
    await reopened.close();
  });

  it("finishes a conversion that stopped part way, and re-keys from one key to another", async () => {
    const inner = createMemoryStorageAdapter();
    const store = await createTestStore(inner);
    await seed(store);
    const before = await contents(store);
    const first = createDataKey();

    // Stop after the first batch commits, as a crash would.
    const commit = inner.commit.bind(inner);
    let commits = 0;
    inner.commit = async (writes) => {
      if (++commits === 2) throw new Error("crash");
      return commit(writes);
    };
    await expect(convertStoredRecords(inner, { from: null, to: first })).rejects.toThrow("crash");
    inner.commit = commit;
    expect(await convertStoredRecords(inner, { from: null, to: first })).toBeGreaterThan(0);
    expect(await convertStoredRecords(inner, { from: null, to: first })).toBe(0);

    const second = createDataKey();
    await convertStoredRecords(inner, { from: first, to: second });
    const reopened = await NotesStore.open({ adapter: withEncryption(inner, second) });
    expect(await contents(reopened)).toEqual(before);
    // Without the old key, records sealed with it can't be converted.
    await expect(
      convertStoredRecords(inner, { from: null, to: createDataKey() }),
    ).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
  });
});

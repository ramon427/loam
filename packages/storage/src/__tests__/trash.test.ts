import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMemoryStorageAdapter } from "../adapters/memoryAdapter";
import { createSqliteStorageAdapter } from "../adapters/sqliteAdapter";
import { withEncryption } from "../encryption/encryptedAdapter";
import { createDataKey } from "../encryption/seal";
import { NotesStore } from "../NotesStore";
import {
  bodyPatch,
  createNote,
  createTestStore,
  folderId,
  noteId,
  paragraph,
  projectId,
  text,
} from "../testing/storeFixtures";
import { createTempDirectories } from "../testing/tempDirectories";

const tempDirectory = createTempDirectories("loam-trash-test-");

it("restores a deleted note after reopening SQLite, with its latest content and original place", async () => {
  const directory = tempDirectory();
  const file = join(directory, "notes.sqlite");
  let adapter = createSqliteStorageAdapter(file);
  let store = await createTestStore(adapter);
  const folder = folderId(1);
  await store.saveLayout({ folders: [{ id: folder, name: "Work" }], notes: [] });
  await createNote(store, noteId(1), { title: "Before", folderId: folder });
  await createNote(store, noteId(2), { title: "Recover", folderId: folder });
  await createNote(store, noteId(3), { title: "After", folderId: folder });
  await store.saveNote(noteId(2), bodyPatch(paragraph(text("Latest words"))));
  await store.deleteNote(noteId(2));
  await adapter.close?.();
  adapter = createSqliteStorageAdapter(file);
  store = await NotesStore.open({ adapter });
  try {
    expect(await store.getTrash()).toEqual([
      { id: noteId(2), title: "Recover", deletedAt: expect.any(Number) },
    ]);
    expect((await store.searchNotes("Latest")).results).toEqual([]);
    const restored = await store.restoreTrashedNote(noteId(2));
    expect(restored.folderId).toBe(folder);
    expect(JSON.stringify(restored.blocksByTab)).toContain("Latest words");
    expect((await store.getLibrary()).notes.map((note) => note.title)).toEqual([
      "Before",
      "Recover",
      "After",
    ]);
    expect(await store.getTrash()).toEqual([]);
    expect((await store.searchNotes("Latest")).results[0]?.noteId).toBe(noteId(2));
  } finally {
    await adapter.close?.();
  }
});

describe("persistent Trash", () => {
  it("recovers notes deleted by older versions, and restores to the top level if the folder is gone", async () => {
    const adapter = createMemoryStorageAdapter();
    let store = await createTestStore(adapter);
    const folder = folderId(1);
    await store.saveLayout({ folders: [{ id: folder, name: "Old folder" }], notes: [] });
    await createNote(store, noteId(1), { title: "Legacy", folderId: folder });
    await createNote(store, noteId(2), { title: "Gone for good" });
    await store.deleteNote(noteId(1));
    await store.deleteNote(noteId(2));
    await store.deleteTrashedNote(noteId(2));
    // v0.1.0 had no Trash: a deleted note was only its newest version in history.
    await adapter.commit([
      { type: "delete", collection: "trash", id: noteId(1) },
      { type: "put", collection: "meta", id: "schema", value: { version: 2 } },
    ]);
    await store.saveLayout({ folders: [], notes: [] });
    store = await createTestStore(adapter);
    expect((await adapter.get("meta", "schema"))?.value).toEqual({ version: 3 });
    expect((await adapter.list("trash")).map((record) => record.id)).toEqual([noteId(1)]);
    expect(await store.getTrash()).toEqual([
      { id: noteId(1), title: "Legacy", deletedAt: expect.any(Number) },
    ]);
    expect((await store.restoreTrashedNote(noteId(1))).folderId).toBeUndefined();
    expect(await store.getTrash()).toEqual([]);
  });

  it("restores a note to its project, or to the top level if the project is gone", async () => {
    const store = await createTestStore();
    const project = projectId(1);
    await store.saveLayout({ projects: [{ id: project, name: "Work" }], folders: [], notes: [] });
    await createNote(store, noteId(1), { title: "First", projectId: project });
    await createNote(store, noteId(2), { title: "Second", projectId: project });
    await createNote(store, noteId(3), { title: "Loose" });
    await store.deleteNote(noteId(1));
    expect(await store.restoreTrashedNote(noteId(1))).toMatchObject({
      projectId: project,
      position: 0,
    });
    expect(
      (await store.getLibrary()).notes.map((note) => [note.title, note.projectId, note.position]),
    ).toEqual([
      ["Loose", undefined, 0],
      ["First", project, 0],
      ["Second", project, 2],
    ]);

    await store.deleteNote(noteId(2));
    await store.saveLayout({ projects: [], folders: [], notes: [] });
    expect(await store.restoreTrashedNote(noteId(2))).toMatchObject({
      projectId: undefined,
      position: 2,
    });
  });

  it("permanent deletion cannot be recovered from history and cannot delete an active note", async () => {
    const adapter = createMemoryStorageAdapter();
    let store = await createTestStore(adapter);
    await createNote(store, noteId(1));
    await expect(store.deleteTrashedNote(noteId(1))).rejects.toMatchObject({ status: 400 });
    await store.deleteNote(noteId(1));
    await store.deleteTrashedNote(noteId(1));
    store = await createTestStore(adapter);
    expect(await store.getTrash()).toEqual([]);
    expect((await store.getNoteHistory(noteId(1))).versions).toEqual([]);
    expect(await adapter.list("revisions")).toEqual([]);
    await expect(store.restoreTrashedNote(noteId(1))).rejects.toMatchObject({ status: 404 });
  });

  it("keeps Trash encrypted and includes it in backups", async () => {
    const raw = createMemoryStorageAdapter();
    const key = createDataKey();
    const store = await createTestStore(withEncryption(raw, key));
    await createNote(store, noteId(1), {
      title: "Private title",
      blocks: [paragraph(text("Private body"))],
    });
    await store.deleteNote(noteId(1));
    expect(JSON.stringify(await raw.list("trash"))).not.toContain("Private");
    const backup = await store.readAllRecords();
    expect(JSON.stringify(backup.trash)).toContain("Private body");
    const reopened = await createTestStore(withEncryption(raw, key));
    expect((await reopened.getTrash())[0]?.title).toBe("Private title");
    expect(JSON.stringify((await reopened.restoreTrashedNote(noteId(1))).blocksByTab)).toContain(
      "Private body",
    );
  });
});

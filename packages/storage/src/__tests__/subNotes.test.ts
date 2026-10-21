import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { NotesBootstrap } from "@loam/shared/notes/noteModel";

import { createMemoryStorageAdapter } from "../adapters/memoryAdapter";
import type { NotesStore } from "../NotesStore";
import { SyncFolder, syncWithFolder } from "../sync/syncFolder";
import { folderStorage } from "../sync/syncStorage";
import { createNote, createTestStore, folderId, noteId, projectId } from "../testing/storeFixtures";
import { createTempDirectories } from "../testing/tempDirectories";

const A = noteId(1);
const B = noteId(2);
const C = noteId(3);
const D = noteId(4);
const F = folderId(1);
const P = projectId(1);

const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("Expected the store to reject.");
    },
    (error: unknown) => error as { code: string },
  );

/**
 * Each note as `id in place #position`, where the place is its parent, folder or project,
 * in id order.
 */
const places = (library: NotesBootstrap) =>
  library.notes
    .map(
      (note) =>
        `${note.id.slice(-1)} in ${
          note.parentNoteId?.slice(-1) ?? note.folderId ?? note.projectId ?? "top"
        } #${note.position}`,
    )
    .sort();

describe("sub-notes in the store", () => {
  it("creates a note inside another, with no folder or project of its own", async () => {
    const store = await createTestStore();
    await store.saveLayout({ projects: [{ id: P, name: "Work" }], folders: [], notes: [] });
    await createNote(store, A, { projectId: P });
    const sub = await createNote(store, B, { parentNoteId: A, projectId: P });
    expect(sub).toMatchObject({ parentNoteId: A, projectId: undefined, position: 0 });
    await createNote(store, C, { parentNoteId: A });
    expect(places(await store.getLibrary())).toEqual([`1 in ${P} #0`, "2 in 1 #0", "3 in 1 #1"]);
    await expect(
      rejection(createNote(store, D, { parentNoteId: noteId(9) })),
    ).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("moves a sub-note out, and keeps parents a layout leaves out", async () => {
    const store = await createTestStore();
    await createNote(store, A);
    await createNote(store, B, { parentNoteId: A });
    await createNote(store, C);
    // An older window or AI client lists notes without parents; they stay where they are.
    let library = await store.saveLayout({
      folders: [],
      notes: [
        { id: C, folderId: null },
        { id: A, folderId: null },
        { id: B, folderId: null },
      ],
    });
    expect(places(library)).toEqual(["1 in top #1", "2 in 1 #0", "3 in top #0"]);
    library = await store.saveLayout({
      folders: [],
      notes: [
        { id: C, folderId: null, parentNoteId: null },
        { id: B, folderId: null, parentNoteId: null },
        { id: A, folderId: null, parentNoteId: null },
      ],
    });
    expect(places(library)).toEqual(["1 in top #2", "2 in top #1", "3 in top #0"]);
    // Into a folder, a note leaves its parent.
    await store.saveLayout({
      folders: [{ id: F, name: "Plans" }],
      notes: [{ id: B, folderId: null, parentNoteId: A }],
    });
    library = await store.saveLayout({
      folders: [{ id: F, name: "Plans" }],
      notes: [{ id: B, folderId: F }],
    });
    expect(library.notes.find((note) => note.id === B)).toMatchObject({
      folderId: F,
      parentNoteId: undefined,
    });
  });

  it("rejects a note put inside itself or its own sub-notes", async () => {
    const store = await createTestStore();
    await createNote(store, A);
    await createNote(store, B, { parentNoteId: A });
    await createNote(store, C, { parentNoteId: B });
    for (const notes of [
      [{ id: A, folderId: null, parentNoteId: A }],
      [{ id: A, folderId: null, parentNoteId: C }],
      [{ id: A, folderId: null, parentNoteId: noteId(9) }],
    ])
      await expect(rejection(store.saveLayout({ folders: [], notes }))).resolves.toMatchObject({
        code: "VALIDATION_ERROR",
      });
  });

  it("keeps a deleted note's sub-notes, in its place, and puts it back without them", async () => {
    const store = await createTestStore();
    await store.saveLayout({ folders: [{ id: F, name: "Plans" }], notes: [] });
    await createNote(store, A, { folderId: F });
    await createNote(store, B, { parentNoteId: A });
    await createNote(store, C, { parentNoteId: A });
    await createNote(store, D, { parentNoteId: B });
    const deleted = await store.deleteNote(A);
    expect(places(await store.getLibrary())).toEqual([`2 in ${F} #1`, `3 in ${F} #2`, "4 in 2 #0"]);
    await store.restoreNote(deleted);
    expect(places(await store.getLibrary())).toContain(`1 in ${F} #0`);
  });

  it("shows notes another computer nested inside each other at the top level", async () => {
    const adapter = createMemoryStorageAdapter();
    const store = await createTestStore(adapter);
    await createNote(store, A);
    await createNote(store, B, { parentNoteId: A });
    await createNote(store, C);
    const row = (await adapter.get("notes", A))!.value as Record<string, unknown>;
    // A loop, and a parent that hasn't arrived.
    await adapter.commit([
      { type: "put", collection: "notes", id: A, value: { ...row, parentNoteId: B } },
      { type: "put", collection: "notes", id: C, value: { ...row, id: C, parentNoteId: D } },
    ]);
    const library = await (await createTestStore(adapter)).getLibrary();
    expect(library.notes.map((note) => note.parentNoteId)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("sub-notes through sync", () => {
  const tempDirectory = createTempDirectories("loam-sub-notes-");
  let folder: string;
  beforeEach(() => {
    folder = tempDirectory();
  });

  const createDevice = async () => {
    const store = await createTestStore();
    const syncFolder = new SyncFolder(folderStorage(folder), await store.readSyncDevice());
    return { store, sync: () => syncWithFolder(store, syncFolder) };
  };
  const syncAll = async (...devices: Array<{ sync: () => Promise<unknown> }>) => {
    for (let round = 0; round < 2; round += 1) for (const device of devices) await device.sync();
  };
  const parentOf = async (store: NotesStore, id: string) =>
    (await store.getLibrary()).notes.find((note) => note.id === id)?.parentNoteId;

  it("brings a note's parent to the other computer, and a move out of it", async () => {
    const one = await createDevice();
    const two = await createDevice();
    await createNote(one.store, A);
    await createNote(one.store, B, { parentNoteId: A });
    await syncAll(one, two);
    expect(await parentOf(two.store, B)).toBe(A);

    await two.store.saveLayout({
      folders: [],
      notes: [{ id: B, folderId: null, parentNoteId: null }],
    });
    await syncAll(one, two);
    expect(await parentOf(one.store, B)).toBeUndefined();
  });

  it("reads places from versions before sub-notes as moves out of the parent", async () => {
    const one = await createDevice();
    const two = await createDevice();
    await createNote(one.store, A);
    await createNote(one.store, B, { parentNoteId: A });
    await syncAll(one, two);
    await one.store.saveLayout({
      folders: [],
      notes: [{ id: B, folderId: null, parentNoteId: null }],
    });
    await one.sync();
    const directory = join(folder, "Loam Sync", "v1", "devices", await one.store.readSyncDevice());
    // An older version's move names no parent.
    for (const name of await readdir(directory)) {
      if (!name.startsWith(`place-${B}`)) continue;
      const change = JSON.parse(await readFile(join(directory, name), "utf8"));
      expect(change.value).not.toHaveProperty("parentNoteId");
      change.value = { folderId: null, position: 0 };
      await writeFile(join(directory, name), JSON.stringify(change));
    }
    await two.sync();
    expect(await parentOf(two.store, B)).toBeUndefined();
  });
});

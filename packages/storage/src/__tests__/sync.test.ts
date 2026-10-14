import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryStorageAdapter } from "../adapters/memoryAdapter";
import type { NotesStore } from "../NotesStore";
import { SyncFolder, syncWithFolder } from "../sync/syncFolder";
import {
  bodyPatch,
  createClock,
  createNote,
  createTestStore,
  folderId,
  noteId,
  paragraph,
  projectId,
  text,
} from "../testing/storeFixtures";
import { createTempDirectories } from "../testing/tempDirectories";

const A = noteId(1);
const B = noteId(2);
const F = folderId(1);
const G = folderId(2);
const P = projectId(1);
const Q = projectId(2);

const tempDirectory = createTempDirectories("loam-sync-");
let folder: string;

beforeEach(() => {
  folder = tempDirectory();
});

type Device = { store: NotesStore; sync: () => ReturnType<typeof syncWithFolder> };

const createDevice = async (
  adapter = createMemoryStorageAdapter(),
  clock = createClock(),
): Promise<Device> => {
  const store = await createTestStore(adapter, clock);
  const syncFolder = new SyncFolder(folder, await store.readSyncDevice());
  return { store, sync: () => syncWithFolder(store, syncFolder) };
};

/** Syncs every device twice over, so each sees what the others published. */
const syncAll = async (...devices: Device[]) => {
  for (let round = 0; round < 2; round += 1) for (const device of devices) await device.sync();
};

const bodyText = async (store: NotesStore, id: string) =>
  JSON.stringify((await store.getNote(id)).blocksByTab).match(/"text":"([^"]*)"/g) ?? [];

/** What a user sees: folders, and each note's title, folder and body, in library order. */
const libraryOf = async (store: NotesStore) => {
  const library = await store.getLibrary();
  return {
    folders: library.folders.map(({ id, name }) => ({ id, name })),
    notes: await Promise.all(
      library.notes.map(async (note) => ({
        id: note.id,
        title: note.title,
        folderId: note.folderId ?? null,
        body: await bodyText(store, note.id),
      })),
    ),
  };
};

const layout = (
  store: NotesStore,
  folders: Array<{ id: string; name: string }>,
  notes: Array<{ id: string; folderId: string | null }>,
) => store.saveLayout({ folders, notes });

describe("sync through a folder", () => {
  it("brings new notes, folders, edits and deletions to the other device", async () => {
    const one = await createDevice();
    const two = await createDevice();
    await layout(one.store, [{ id: F, name: "Biology" }], []);
    await createNote(one.store, A, { title: "Cells", folderId: F });
    await syncAll(one, two);
    expect(await libraryOf(two.store)).toEqual(await libraryOf(one.store));
    expect((await two.store.getLibrary()).notes[0]).toMatchObject({ title: "Cells", folderId: F });

    await one.store.saveNote(A, {
      title: "Cell biology",
      ...bodyPatch(paragraph(text("Mitosis"))),
    });
    await syncAll(one, two);
    expect(await bodyText(two.store, A)).toEqual(['"text":"Mitosis"']);
    expect((await two.store.getNote(A)).title).toBe("Cell biology");

    await two.store.deleteNote(A);
    await syncAll(one, two);
    expect((await one.store.getLibrary()).notes).toEqual([]);
    expect((await one.store.getTrash())[0]?.title).toBe("Cell biology");
    await one.store.restoreTrashedNote(A);
    await syncAll(one, two);
    expect((await two.store.getNote(A)).title).toBe("Cell biology");
    expect(await two.store.getTrash()).toEqual([]);
  });

  it("syncs folder renames, deletions and moves without conflicts", async () => {
    const one = await createDevice();
    const two = await createDevice();
    await layout(
      one.store,
      [
        { id: F, name: "Inbox" },
        { id: G, name: "Archive" },
      ],
      [],
    );
    await createNote(one.store, A, { folderId: F });
    await createNote(one.store, B, { folderId: F });
    await syncAll(one, two);

    // Moving a note on one device while editing it on the other is not a conflict.
    await layout(
      one.store,
      [
        { id: F, name: "Today" },
        { id: G, name: "Archive" },
      ],
      [
        { id: B, folderId: F },
        { id: A, folderId: G },
      ],
    );
    await two.store.saveNote(A, bodyPatch(paragraph(text("Edited elsewhere"))));
    await syncAll(one, two);

    for (const device of [one, two]) {
      const library = await device.store.getLibrary();
      expect(library.folders.map((entry) => entry.name)).toEqual(["Today", "Archive"]);
      expect(library.notes.find((note) => note.id === A)?.folderId).toBe(G);
      expect(library.notes).toHaveLength(2);
      expect(await bodyText(device.store, A)).toEqual(['"text":"Edited elsewhere"']);
    }
  });

  it("keeps both versions when a note is edited on two devices at once", async () => {
    const one = await createDevice();
    const two = await createDevice();
    await createNote(one.store, A, { title: "Plan", folderId: undefined });
    await syncAll(one, two);

    await one.store.saveNote(A, bodyPatch(paragraph(text("From one"))));
    await two.store.saveNote(A, bodyPatch(paragraph(text("From two"))));
    const first = await one.sync();
    await two.sync();
    await one.sync();

    expect(await libraryOf(one.store)).toEqual(await libraryOf(two.store));
    const notes = (await one.store.getLibrary()).notes;
    expect(notes.map((note) => note.title).sort()).toEqual(["Plan", "Plan (conflict copy)"]);
    const copy = notes.find((note) => note.title.endsWith("(conflict copy)"))!;
    // The newer edit stays in the note; the other is the copy.
    expect(
      [...(await bodyText(one.store, A)), ...(await bodyText(one.store, copy.id))].sort(),
    ).toEqual(['"text":"From one"', '"text":"From two"']);
    // One published first, so it learns of the conflict only from two.
    expect(first.conflictCopies).toEqual([]);
  });

  it("converges on three devices editing one note at once", async () => {
    const devices = [await createDevice(), await createDevice(), await createDevice()];
    await createNote(devices[0]!.store, A, { title: "Trip" });
    await syncAll(...devices);
    for (const [index, device] of devices.entries())
      await device.store.saveNote(A, bodyPatch(paragraph(text(`Version ${index}`))));
    await syncAll(...devices);

    const [first, ...others] = await Promise.all(devices.map((device) => libraryOf(device.store)));
    for (const other of others) expect(other).toEqual(first);
    expect(first!.notes.map((note) => note.body[0]).sort()).toEqual([
      '"text":"Version 0"',
      '"text":"Version 1"',
      '"text":"Version 2"',
    ]);
  });

  it("doesn't count a save that changes nothing as an edit", async () => {
    const one = await createDevice();
    const two = await createDevice();
    await createNote(one.store, A, { title: "Same" });
    await syncAll(one, two);
    // Editors hand back unchanged content; that must not race the other device's edit.
    const before = await one.store.getNote(A);
    const saved = await one.store.saveNote(A, { title: "Same", tabs: before.tabs });
    expect(saved.updatedAt).toBe(before.updatedAt);
    expect(await one.store.countUnpublishedChanges()).toBe(0);

    await two.store.saveNote(A, { title: "Changed elsewhere" });
    await syncAll(one, two);
    expect((await one.store.getLibrary()).notes.map((note) => note.title)).toEqual([
      "Changed elsewhere",
    ]);
  });

  it("merges identical edits silently", async () => {
    const one = await createDevice();
    const two = await createDevice();
    await createNote(one.store, A);
    await syncAll(one, two);
    await one.store.saveNote(A, { title: "Same" });
    await two.store.saveNote(A, { title: "Same" });
    await syncAll(one, two);
    expect((await one.store.getLibrary()).notes).toHaveLength(1);
    expect((await two.store.getLibrary()).notes).toHaveLength(1);
  });

  it("keeps a note edited on one device while another deletes it", async () => {
    const one = await createDevice();
    const two = await createDevice();
    await createNote(one.store, A);
    await syncAll(one, two);
    await one.store.deleteNote(A);
    await two.store.saveNote(A, bodyPatch(paragraph(text("Still needed"))));
    await syncAll(one, two);
    for (const device of [one, two])
      expect(await bodyText(device.store, A)).toEqual(['"text":"Still needed"']);
  });

  it("shows notes of a folder deleted elsewhere at the top level, and lets a rename beat the delete", async () => {
    const one = await createDevice();
    const two = await createDevice();
    await layout(
      one.store,
      [
        { id: F, name: "Old" },
        { id: G, name: "Keep" },
      ],
      [],
    );
    await syncAll(one, two);

    await layout(one.store, [], []);
    await createNote(two.store, A, { folderId: F });
    await layout(
      two.store,
      [
        { id: F, name: "Old" },
        { id: G, name: "Kept" },
      ],
      [{ id: A, folderId: F }],
    );
    await syncAll(one, two);

    for (const device of [one, two]) {
      const library = await device.store.getLibrary();
      expect(library.folders.map((entry) => entry.name)).toEqual(["Kept"]);
      expect(library.notes).toEqual([expect.objectContaining({ id: A })]);
      expect(library.notes[0]!.folderId).toBeUndefined();
    }
  });

  it("syncs projects and what is filed into them", async () => {
    const one = await createDevice();
    const two = await createDevice();
    await createNote(one.store, A);
    await createNote(one.store, B);
    await one.store.saveLayout({
      projects: [
        { id: P, name: "Work", icon: { kind: "symbol", value: "rocket", color: "green" } },
        { id: Q, name: "Home" },
      ],
      folders: [{ id: F, name: "Plans", projectId: P }],
      notes: [
        { id: A, folderId: F },
        { id: B, folderId: null, projectId: P },
      ],
    });
    await syncAll(one, two);
    let library = await two.store.getLibrary();
    expect(library.projects).toEqual((await one.store.getLibrary()).projects);
    expect(library.folders).toEqual([{ id: F, name: "Plans", position: 0, projectId: P }]);
    expect(library.notes.find((note) => note.id === B)?.projectId).toBe(P);

    await two.store.saveLayout({
      projects: [{ id: P, name: "Job", icon: { kind: "emoji", value: "💼" } }],
      folders: [{ id: F, name: "Plans" }],
      notes: [],
    });
    await syncAll(one, two);
    for (const device of [one, two]) {
      library = await device.store.getLibrary();
      expect(library.projects).toEqual([
        { id: P, name: "Job", position: 0, icon: { kind: "emoji", value: "💼" } },
      ]);
      expect(library.folders[0]?.projectId).toBe(P);
      expect(library.notes.find((note) => note.id === B)?.projectId).toBe(P);
    }

    await one.store.saveLayout({
      folders: [{ id: F, name: "Plans", projectId: null }],
      notes: [{ id: B, folderId: null, projectId: null }],
    });
    await syncAll(one, two);
    library = await two.store.getLibrary();
    expect(library.folders[0]?.projectId).toBeUndefined();
    expect(library.notes.find((note) => note.id === B)?.projectId).toBeUndefined();
  });

  it("moves what a project deleted elsewhere held to the top level, and lets a rename beat the delete", async () => {
    const one = await createDevice();
    const two = await createDevice();
    await createNote(one.store, A);
    await one.store.saveLayout({
      projects: [{ id: P, name: "Work" }],
      folders: [{ id: F, name: "Plans", projectId: P }],
      notes: [{ id: A, folderId: null, projectId: P }],
    });
    await syncAll(one, two);

    await one.store.saveLayout({ projects: [], folders: [{ id: F, name: "Plans" }], notes: [] });
    await two.store.saveLayout({
      projects: [{ id: P, name: "Still work" }],
      folders: [{ id: F, name: "Plans" }],
      notes: [],
    });
    await syncAll(one, two);

    for (const device of [one, two]) {
      const library = await device.store.getLibrary();
      expect(library.projects).toEqual([{ id: P, name: "Still work", position: 0 }]);
      // The delete moved the folder and note out; those moves stand.
      expect(library.folders[0]?.projectId).toBeUndefined();
      expect(library.notes[0]?.projectId).toBeUndefined();
    }
  });

  it("reads folders and places published before projects", async () => {
    const one = await createDevice();
    const two = await createDevice();
    await one.store.saveLayout({
      projects: [{ id: P, name: "Work" }],
      folders: [{ id: F, name: "Inbox", projectId: P }],
      notes: [],
    });
    await createNote(one.store, A, { folderId: F });
    await one.sync();
    const directory = join(folder, "Loam Sync", "v1", "devices", await one.store.readSyncDevice());
    // Older versions wrote folders without a project, as a note in a folder is still written.
    for (const name of await readdir(directory)) {
      if (!name.startsWith("folder-")) continue;
      const change = JSON.parse(await readFile(join(directory, name), "utf8"));
      delete change.value.projectId;
      await writeFile(join(directory, name), JSON.stringify(change));
    }
    await two.sync();
    const library = await two.store.getLibrary();
    expect(library.folders).toEqual([{ id: F, name: "Inbox", position: 0 }]);
    expect(library.notes).toEqual([expect.objectContaining({ id: A, folderId: F })]);
  });

  it("skips a change file until it is complete", async () => {
    const one = await createDevice();
    const two = await createDevice();
    await createNote(one.store, A, { title: "Arriving" });
    await one.sync();
    const directory = join(folder, "Loam Sync", "v1", "devices", await one.store.readSyncDevice());
    const [name] = (await readdir(directory)).filter((file) => file.startsWith("note-"));
    const complete = await import("node:fs/promises").then((fs) =>
      fs.readFile(join(directory, name!), "utf8"),
    );
    await writeFile(join(directory, name!), complete.slice(0, complete.length / 2));

    const partial = await two.sync();
    expect(partial.unreadable).toBe(1);
    expect((await two.store.getLibrary()).notes).toEqual([]);

    await writeFile(join(directory, name!), complete);
    await two.sync();
    expect((await two.store.getLibrary()).notes.map((note) => note.title)).toEqual(["Arriving"]);
  });

  it("skips a change whose note can't be read, and keeps the note it would replace", async () => {
    const one = await createDevice();
    const two = await createDevice();
    await createNote(one.store, A, { title: "Shared", blocks: [paragraph(text("First"))] });
    await syncAll(one, two);
    await one.store.saveNote(A, bodyPatch(paragraph(text("Second"))));
    await one.sync();
    const directory = join(folder, "Loam Sync", "v1", "devices", await one.store.readSyncDevice());
    const [name] = (await readdir(directory)).filter((file) => file.startsWith(`note-${A}`));
    const change = JSON.parse(await readFile(join(directory, name!), "utf8"));
    // Valid JSON from another version or a damaged copy: its graph has no lists.
    change.value.graphsByTab = { "tab-1": {} };
    await writeFile(join(directory, name!), JSON.stringify(change));

    await two.sync();
    expect(await bodyText(two.store, A)).toEqual(['"text":"First"']);
    await expect(two.store.deleteNote(A)).resolves.toMatchObject({ id: A });
  });

  it("skips changes that are valid JSON but not valid changes, and applies the rest", async () => {
    const one = await createDevice();
    const two = await createDevice();
    await layout(one.store, [{ id: F, name: "Kept" }], []);
    await createNote(one.store, A, { title: "Kept", folderId: F });
    await createNote(one.store, B, { title: "Damaged" });
    await one.sync();
    const device = await one.store.readSyncDevice();
    const directory = join(folder, "Loam Sync", "v1", "devices", device);
    const files = await readdir(directory);
    const read = async (prefix: string) =>
      JSON.parse(
        await readFile(
          join(
            directory,
            files.find((file) => file.startsWith(prefix))!,
          ),
          "utf8",
        ),
      );
    let planted = 0;
    /** Adds a change file under a later clock of the same device, beside the real ones. */
    const plant = async (kind: string, id: string, change: (clock: string) => unknown) => {
      const clock = `zzzzzzzzz-${String(++planted).padStart(4, "0")}-${device}`;
      await writeFile(
        join(directory, `${kind}-${id}~${clock}.json`),
        JSON.stringify(change(clock)),
      );
    };
    const later = (stored: Record<string, unknown>, clock: string) => ({
      ...stored,
      clock,
      vector: { [device]: clock },
    });

    // B's note and place are rewritten in place: neither holds what its kind needs.
    for (const [prefix, value] of [
      [`note-${B}`, { title: 5, tabs: "none" }],
      [`place-${B}`, { folderId: "not an id", position: -1 }],
    ] as const) {
      const name = files.find((file) => file.startsWith(prefix))!;
      const stored = await read(prefix);
      await writeFile(join(directory, name), JSON.stringify({ ...stored, value }));
    }
    const note = await read(`note-${A}`);
    const place = await read(`place-${A}`);
    const folderChange = await read(`folder-${F}`);
    await plant("note", A, (clock) => ({ ...later(note, clock), savedAt: "yesterday" }));
    await plant("place", A, (clock) => ({ ...later(place, clock), key: `place:${B}` }));
    await plant("folder", F, (clock) => ({ ...later(folderChange, clock), vector: {} }));
    await plant("folder", G, (clock) => ({
      ...later(folderChange, clock),
      key: `folder:${G}`,
      value: { name: 7, position: 1 },
    }));
    for (const value of [null, [], "text", 42]) await plant("note", noteId(9), () => value);

    const result = await two.sync();
    expect(result.unreadable).toBe(10);
    expect(await libraryOf(two.store)).toEqual({
      folders: [{ id: F, name: "Kept" }],
      notes: [{ id: A, title: "Kept", folderId: F, body: ['"text":"Body"'] }],
    });
  });

  it("puts a note where its place says when the place arrives first", async () => {
    const one = await createDevice();
    const two = await createDevice();
    await layout(one.store, [{ id: F, name: "Biology" }], []);
    await createNote(one.store, B, { title: "Already there", folderId: F });
    await createNote(one.store, A, { title: "Late", folderId: F });
    await one.sync();
    const directory = join(folder, "Loam Sync", "v1", "devices", await one.store.readSyncDevice());
    // The cloud drive hasn't brought A's note file yet, only its place.
    const name = (await readdir(directory)).find((file) => file.startsWith(`note-${A}`))!;
    const held = join(folder, name);
    await rename(join(directory, name), held);
    const early = await two.sync();
    expect(early.layoutChanged).toBe(true);
    expect((await libraryOf(two.store)).notes.map((note) => note.id)).toEqual([B]);

    await rename(held, join(directory, name));
    await two.sync();
    expect(await libraryOf(two.store)).toEqual(await libraryOf(one.store));
    expect((await two.store.getLibrary()).notes.map((note) => [note.id, note.position])).toEqual([
      [B, 0],
      [A, 1],
    ]);
    // The waiting place is used once: a later move of A still applies.
    await layout(
      one.store,
      [{ id: F, name: "Biology" }],
      [
        { id: A, folderId: null },
        { id: B, folderId: F },
      ],
    );
    await syncAll(one, two);
    expect(await libraryOf(two.store)).toEqual(await libraryOf(one.store));
  });

  it("syncs a note whose id is in capitals", async () => {
    const one = await createDevice();
    const two = await createDevice();
    const id = "ABCDEF00-0000-4000-8000-00000000000A";
    await createNote(one.store, id, { title: "Shouted" });
    await syncAll(one, two);
    expect((await libraryOf(two.store)).notes).toEqual([
      expect.objectContaining({ id, title: "Shouted" }),
    ]);
  });

  it("catches up a device that was offline for many changes", async () => {
    const one = await createDevice();
    const two = await createDevice();
    await syncAll(one, two);
    await layout(one.store, [{ id: F, name: "Projects" }], []);
    for (let index = 1; index <= 30; index += 1)
      await createNote(one.store, noteId(index), {
        title: `Note ${index}`,
        folderId: index % 2 ? F : undefined,
      });
    for (let index = 1; index <= 10; index += 1)
      await one.store.saveNote(noteId(index), { title: `Edited ${index}` });
    for (let index = 21; index <= 30; index += 1) await one.store.deleteNote(noteId(index));
    await syncAll(one, two);
    expect(await libraryOf(two.store)).toEqual(await libraryOf(one.store));
    expect((await two.store.getLibrary()).notes).toHaveLength(20);
  });

  it("merges a device's own notes into the library when it joins", async () => {
    const one = await createDevice();
    const two = await createDevice();
    await createNote(one.store, A, { title: "From one" });
    await createNote(two.store, B, { title: "From two" });
    await syncAll(one, two);
    for (const device of [one, two])
      expect((await device.store.getLibrary()).notes.map((note) => note.title).sort()).toEqual([
        "From one",
        "From two",
      ]);
  });

  it("publishes a restored library to the other devices", async () => {
    const one = await createDevice();
    const two = await createDevice();
    await createNote(one.store, A, { title: "Before" });
    await syncAll(one, two);
    const backup = await one.store.readAllRecords();
    expect(backup).not.toHaveProperty("sync");

    await one.store.saveNote(A, { title: "After" });
    await createNote(one.store, B, { title: "Made after the backup" });
    await syncAll(one, two);
    await one.store.replaceAllRecords(backup);
    await syncAll(one, two);

    for (const device of [one, two])
      expect((await device.store.getLibrary()).notes.map((note) => note.title)).toEqual(["Before"]);
  });

  it("keeps the synced version when the window saves an edit made before it arrived", async () => {
    const one = await createDevice();
    const two = await createDevice();
    await createNote(one.store, A, { title: "Shared" });
    await syncAll(one, two);
    const opened = await two.store.getNote(A);

    await one.store.saveNote(A, bodyPatch(paragraph(text("Synced in"))));
    await syncAll(one, two);
    const saved = await two.store.saveNote(
      A,
      bodyPatch(paragraph(text("Typed meanwhile"))),
      opened.updatedAt,
    );

    expect(saved.conflictCopy).toMatchObject({ title: "Shared (conflict copy)" });
    expect(await bodyText(two.store, A)).toEqual(['"text":"Typed meanwhile"']);
    expect(await bodyText(two.store, saved.conflictCopy!.id)).toEqual(['"text":"Synced in"']);

    // A later save made with the current version is an ordinary save.
    const again = await two.store.saveNote(A, { title: "Renamed" }, saved.updatedAt);
    expect(again.conflictCopy).toBeUndefined();
  });

  it("keeps one file per document and its state across a restart", async () => {
    const adapter = createMemoryStorageAdapter();
    const one = await createDevice(adapter);
    await createNote(one.store, A);
    for (let index = 0; index < 3; index += 1) {
      await one.store.saveNote(A, { title: `Title ${index}` });
      await one.sync();
    }
    const directory = join(folder, "Loam Sync", "v1", "devices", await one.store.readSyncDevice());
    expect((await readdir(directory)).sort()).toEqual([
      expect.stringMatching(/^note-/),
      expect.stringMatching(/^place-/),
    ]);

    const reopened = await createDevice(adapter);
    expect(await reopened.store.readSyncDevice()).toBe(await one.store.readSyncDevice());
    expect(await reopened.store.countUnpublishedChanges()).toBe(0);
    expect((await reopened.sync()).published).toBe(0);
  });

  it("refuses a sync folder made by a newer version", async () => {
    const one = await createDevice();
    await one.sync();
    await writeFile(
      join(folder, "Loam Sync", "v1", "library.json"),
      JSON.stringify({ format: 3, libraryId: "x" }),
    );
    await expect(one.sync()).rejects.toThrow("newer version of Loam");
  });
});

import { describe, expect, it } from "vitest";

import type { BridgeImportNote } from "@loam/shared/bridge/loamBridge";

import { placeImportedNotes, writeImportedNotes } from "../placement";
import {
  createNote,
  createTestStore,
  folderId,
  noteId,
  paragraph,
  text,
} from "@loam/storage/testing/storeFixtures";

const folder = { id: folderId(1), name: "Research" };

let counter = 100;
const createId = () => folderId(++counter);

const importedNote = (id: string, title: string, folderName: string | null): BridgeImportNote => ({
  id,
  title,
  folder: folderName,
  tabs: [{ id: "tab-1", title: "Notes", kind: "page" }],
  blocksByTab: { "tab-1": [paragraph(text(`${title} body`))] },
  activeTabId: "tab-1",
});

/** A library with one existing note at the root and one inside "Research". */
const seededStore = async () => {
  const store = await createTestStore();
  await store.saveLayout({ folders: [folder], notes: [] });
  await createNote(store, noteId(1), { title: "Root note" });
  await createNote(store, noteId(2), { title: "Research note", folderId: folder.id });
  return store;
};

const runImport = async (
  store: Awaited<ReturnType<typeof seededStore>>,
  notes: BridgeImportNote[],
) => placeImportedNotes(store, await writeImportedNotes(store, notes), createId);

describe("importing notes", () => {
  it("adds notes and folders without moving or changing existing notes", async () => {
    const store = await seededStore();
    const before = await Promise.all([store.getNote(noteId(1)), store.getNote(noteId(2))]);

    const plan = importedNote(noteId(10), "Plan", "Projects");
    const result = await runImport(store, [
      plan,
      importedNote(noteId(11), "Loose", null),
      importedNote(noteId(12), "Findings", "research"),
    ]);

    expect(result).toEqual({ folderCount: 1 });
    const bootstrap = await store.getLibrary();
    expect(bootstrap.folders.map((entry) => entry.name)).toEqual(["Research", "Projects"]);
    const projects = bootstrap.folders[1]!.id;
    const titlesIn = (folderId: string | null) =>
      bootstrap.notes
        .filter((note) => (note.folderId ?? null) === folderId)
        .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
        .map((note) => note.title);
    expect(titlesIn(null)).toEqual(["Root note", "Loose"]);
    expect(titlesIn(folder.id)).toEqual(["Research note", "Findings"]);
    expect(titlesIn(projects)).toEqual(["Plan"]);
    expect(await Promise.all([store.getNote(noteId(1)), store.getNote(noteId(2))])).toEqual(before);
    const imported = await store.getNote(noteId(10));
    expect(imported.blocksByTab).toEqual(plan.blocksByTab);
    expect(imported.folderId).toBe(projects);
  });

  it("finds imported notes by search and backlinks", async () => {
    const store = await seededStore();
    await runImport(store, [
      {
        ...importedNote(noteId(20), "Linker", null),
        blocksByTab: {
          "tab-1": [
            paragraph(text("See "), {
              type: "link",
              href: `/notes?noteId=${noteId(1)}`,
              content: [text("the root note")],
            } as never),
          ],
        },
      },
    ]);
    expect((await store.searchNotes("Linker", 10)).results.map((hit) => hit.noteId)).toContain(
      noteId(20),
    );
    expect((await store.getBacklinks(noteId(1))).notes.map((note) => note.id)).toEqual([
      noteId(20),
    ]);
  });

  it("refuses ids that exist or repeat, and leaves the library untouched", async () => {
    const store = await seededStore();
    const write = (notes: BridgeImportNote[]) => writeImportedNotes(store, notes);

    await expect(write([importedNote(noteId(1), "Clash", null)])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      write([importedNote(noteId(30), "A", null), importedNote(noteId(30), "B", null)]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(write([importedNote("not-a-uuid", "Bad", null)])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect((await store.getLibrary()).notes).toHaveLength(2);
  });
});

import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMemoryStorageAdapter } from "../adapters/memoryAdapter";
import { createSqliteStorageAdapter } from "../adapters/sqliteAdapter";
import {
  createNote,
  createTestStore,
  newNote,
  noteId,
  paragraph,
  text,
} from "../testing/storeFixtures";
import { createTempDirectories } from "../testing/tempDirectories";

const tempDirectory = createTempDirectories("loam-search-");

for (const indexed of [false, true])
  describe(indexed ? "SQLite search navigation" : "scan search navigation", () => {
    it("pages through every match without losing or repeating notes", async () => {
      const directory = indexed ? tempDirectory() : null;
      const adapter = directory
        ? createSqliteStorageAdapter(join(directory, "notes.sqlite"))
        : createMemoryStorageAdapter();
      try {
        const store = await createTestStore(adapter);
        for (let index = 1; index <= 63; index++)
          await createNote(store, noteId(index), { title: `Topic ${index}` });
        const ids: string[] = [];
        for (const offset of [0, 20, 40, 60]) {
          const data = await store.searchNotes("topic", 20, offset);
          ids.push(...data.results.map((result) => result.noteId));
          expect(data.hasMore).toBe(offset < 60);
        }
        expect(ids).toHaveLength(63);
        expect(new Set(ids).size).toBe(63);
        expect((await store.searchNotes("topic", 20, 63)).results).toEqual([]);
      } finally {
        await adapter.close?.();
      }
    });

    it("identifies a matching inactive page tab, including accent-insensitive searches", async () => {
      const directory = indexed ? tempDirectory() : null;
      const adapter = directory
        ? createSqliteStorageAdapter(join(directory, "notes.sqlite"))
        : createMemoryStorageAdapter();
      try {
        const store = await createTestStore(adapter);
        await store.createNote({
          ...newNote(noteId(1)),
          tabs: [
            { id: "overview", title: "Overview" },
            { id: "details", title: "Details" },
          ],
          activeTabId: "overview",
          blocksByTab: {
            overview: [paragraph(text("Nothing here"))],
            details: [paragraph(text("Café nebula"))],
          },
        });
        expect((await store.searchNotes("nebula")).results[0]?.tabId).toBe("details");
        expect((await store.searchNotes("cafe")).results[0]?.tabId).toBe("details");
        expect((await store.searchNotes("Untitled nebula")).results[0]).toMatchObject({
          tabId: "details",
          matchText: "nebula",
        });
        expect((await store.getNote(noteId(1))).activeTabId).toBe("overview");
      } finally {
        await adapter.close?.();
      }
    });
  });

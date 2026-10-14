import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMemoryStorageAdapter } from "../adapters/memoryAdapter";
import { buildFtsQuery, createSqliteStorageAdapter } from "../adapters/sqliteAdapter";
import type { StorageAdapter } from "../adapter";
import { withEncryption } from "../encryption/encryptedAdapter";
import { createDataKey } from "../encryption/seal";
import { NotesStore } from "../NotesStore";
import { createNote, noteId, paragraph, text } from "../testing/storeFixtures";
import { createTempDirectories } from "../testing/tempDirectories";

const tempDirectory = createTempDirectories("loam-store-");
const tempDatabase = () => join(tempDirectory(), "notes.sqlite");

/**
 * The behavior NotesStore relies on. A custom adapter (for example one backed by
 * a server database) should pass these same cases.
 */
const adapterFactories: Array<[string, () => StorageAdapter]> = [
  ["memory", createMemoryStorageAdapter],
  ["sqlite", () => createSqliteStorageAdapter(tempDatabase())],
  ["encrypted", () => withEncryption(createSqliteStorageAdapter(tempDatabase()), createDataKey())],
];

describe.each(adapterFactories)("%s storage adapter contract", (_name, createAdapter) => {
  it("stores, lists and deletes records", async () => {
    const adapter = createAdapter();
    expect(await adapter.get("notes", "a")).toBeNull();

    await adapter.commit([{ type: "put", collection: "notes", id: "a", value: { n: 1 } }]);
    expect(await adapter.get("notes", "a")).toEqual({ id: "a", value: { n: 1 } });

    await adapter.commit([{ type: "put", collection: "notes", id: "a", value: { n: 2 } }]);
    await adapter.commit([{ type: "put", collection: "notes", id: "b", value: { n: 3 } }]);
    expect(await adapter.get("notes", "a")).toEqual({ id: "a", value: { n: 2 } });
    expect((await adapter.list("notes")).map((record) => record.id).sort()).toEqual(["a", "b"]);
    expect(await adapter.list("library")).toEqual([]);

    await adapter.commit([{ type: "delete", collection: "notes", id: "a" }]);
    expect(await adapter.get("notes", "a")).toBeNull();
    await adapter.close?.();
  });

  it("applies nothing when one of the writes fails", async () => {
    const adapter = createAdapter();
    await adapter.commit([{ type: "put", collection: "meta", id: "x", value: 1 }]);
    const unreadable = {
      get broken() {
        throw new Error("cannot read");
      },
    };

    await expect(
      adapter.commit([
        { type: "put", collection: "meta", id: "x", value: 2 },
        { type: "put", collection: "meta", id: "y", value: unreadable },
      ]),
    ).rejects.toThrow();
    expect(await adapter.get("meta", "x")).toEqual({ id: "x", value: 1 });
    expect(await adapter.get("meta", "y")).toBeNull();
    await adapter.close?.();
  });

  it("returns copies, so callers cannot mutate stored values", async () => {
    const adapter = createAdapter();
    const value = { nested: { title: "Original" } };
    await adapter.commit([{ type: "put", collection: "notes", id: "a", value }]);
    value.nested.title = "Changed after write";
    const read = (await adapter.get("notes", "a"))!.value as typeof value;
    read.nested.title = "Changed after read";
    expect((await adapter.get("notes", "a"))!.value).toEqual({ nested: { title: "Original" } });
    await adapter.close?.();
  });

  it("stores collections it doesn't know, as later versions may add them", async () => {
    const adapter = createAdapter();
    await adapter.commit([{ type: "put", collection: "added-later", id: "a", value: [1] }]);
    expect(await adapter.get("added-later", "a")).toEqual({ id: "a", value: [1] });
    expect(await adapter.list("added-later")).toEqual([{ id: "a", value: [1] }]);
    expect(await adapter.get("notes", "a")).toBeNull();
    await adapter.close?.();
  });

  it("streams a snapshot from one point in time while writes go on", async () => {
    const adapter = createAdapter();
    if (!adapter.readSnapshot) return;
    await adapter.commit([
      { type: "put", collection: "notes", id: "a", value: { n: 1 } },
      { type: "put", collection: "notes", id: "b", value: { n: 2 } },
    ]);
    const seen: string[] = [];
    for await (const record of adapter.readSnapshot()) {
      if (seen.length === 0)
        await adapter.commit([
          { type: "delete", collection: "notes", id: "b" },
          { type: "put", collection: "notes", id: "c", value: { n: 3 } },
        ]);
      seen.push(`${record.collection}/${record.id}`);
      expect(() => JSON.parse(record.json)).not.toThrow();
    }
    expect(seen).toEqual(["notes/a", "notes/b"]);
    expect((await adapter.list("notes")).map((record) => record.id)).toEqual(["a", "c"]);
    await adapter.close?.();
  });

  it("backs a working NotesStore", async () => {
    const store = await NotesStore.open({ adapter: createAdapter() });
    await createNote(store, noteId(1), { title: "Contract" });
    expect((await store.getNote(noteId(1))).title).toBe("Contract");
    await store.close();
  });
});

describe("sqlite storage adapter", () => {
  it("keeps notes across a reopen", async () => {
    const filename = tempDatabase();
    const first = await NotesStore.open({ adapter: createSqliteStorageAdapter(filename) });
    await createNote(first, noteId(1), { title: "Survives restart" });
    await first.close();

    const reopened = await NotesStore.open({ adapter: createSqliteStorageAdapter(filename) });
    expect((await reopened.getNote(noteId(1))).title).toBe("Survives restart");
    await reopened.close();
  });

  it("searches note text with prefix matching through the full-text index", async () => {
    const store = await NotesStore.open({ adapter: createSqliteStorageAdapter(tempDatabase()) });
    await createNote(store, noteId(1), {
      title: "Cells",
      blocks: [paragraph(text("The mitochondria is the powerhouse of the cell."))],
    });
    await createNote(store, noteId(2), { title: "Mitosis", blocks: [paragraph(text("Division"))] });

    const byPrefix = await store.searchNotes("mitochon");
    expect(byPrefix.results.map((result) => result.noteId)).toEqual([noteId(1)]);
    // Title hits rank above body hits.
    const byTitle = await store.searchNotes("mito");
    expect(byTitle.results[0]?.noteId).toBe(noteId(2));
    await store.close();
  });

  it("replaces a note's search entry when it changes or is deleted", async () => {
    const adapter = createSqliteStorageAdapter(tempDatabase());
    const put = (id: string, text: string) =>
      adapter.commit([{ type: "put", collection: "notes", id, value: { title: id, text } }]);
    await put("a", "first draft");
    await put("a", "second draft");
    await put("b", "first impressions");
    expect((await adapter.searchNotes!("first", 10)).map((hit) => hit.id)).toEqual(["b"]);
    expect((await adapter.searchNotes!("second", 10)).map((hit) => hit.id)).toEqual(["a"]);
    await adapter.commit([{ type: "delete", collection: "notes", id: "a" }]);
    expect(await adapter.searchNotes!("second", 10)).toEqual([]);
    await adapter.close!();
  });

  it("rebuilds the search index of a database from an older version once", async () => {
    const filename = tempDatabase();
    // An older database: no row map, and a search index that is out of date.
    const old = new DatabaseSync(filename);
    old.exec(`
      create table records (collection text not null, id text not null, version integer not null,
        value text not null, primary key (collection, id)) strict;
      create virtual table notes_fts using fts5(id unindexed, title, text);
      insert into records values ('notes', 'a', 1, '{"title":"Kept","text":"current words"}');
      insert into notes_fts (id, title, text) values ('a', 'Kept', 'stale words');
    `);
    old.close();

    const adapter = createSqliteStorageAdapter(filename);
    expect((await adapter.searchNotes!("current", 10)).map((hit) => hit.id)).toEqual(["a"]);
    expect(await adapter.searchNotes!("stale", 10)).toEqual([]);
    await adapter.commit([
      {
        type: "put",
        collection: "notes",
        id: "a",
        value: { title: "Kept", text: "newer words" },
      },
    ]);
    expect((await adapter.searchNotes!("newer", 10)).map((hit) => hit.id)).toEqual(["a"]);
    expect(await adapter.searchNotes!("current", 10)).toEqual([]);
    await adapter.close!();
    // Records no longer carry a version number.
    const upgraded = new DatabaseSync(filename);
    const columns = upgraded.prepare("select name from pragma_table_info('records')").all();
    expect(columns.map((column) => column.name)).toEqual(["collection", "id", "value"]);
    upgraded.close();
  });

  it("upgrades a database whose search row map has no text hashes yet", async () => {
    const filename = tempDatabase();
    const v2 = new DatabaseSync(filename);
    v2.exec(`
      create table records (collection text not null, id text not null, version integer not null,
        value text not null, primary key (collection, id)) strict;
      create virtual table notes_fts using fts5(id unindexed, title, text);
      create table notes_fts_rows (id text primary key, fts_rowid integer not null) strict;
      insert into records values ('notes', 'a', 1, '{"title":"Kept","text":"current words"}');
      pragma user_version = 2;
    `);
    v2.close();
    const adapter = createSqliteStorageAdapter(filename);
    expect((await adapter.searchNotes!("current", 10)).map((hit) => hit.id)).toEqual(["a"]);
    await adapter.close!();
  });

  it("keeps user input out of FTS query syntax", () => {
    expect(buildFtsQuery('alpha "beta" OR gamma*')).toBe('"alpha"* "beta"* "OR"* "gamma*"*');
    expect(buildFtsQuery("   ")).toBe("");
  });
});

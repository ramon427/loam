import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type {
  StorageAdapter,
  StorageNoteSearchFields,
  StorageSearchHit,
  StorageWrite,
  StoredRecord,
} from "../adapter";

const SCHEMA = `
  create table if not exists records (
    collection text not null,
    id text not null,
    value text not null,
    primary key (collection, id)
  ) strict;
  create virtual table if not exists notes_fts using fts5(
    id unindexed,
    title,
    text,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  create table if not exists notes_fts_rows (
    id text primary key,
    fts_rowid integer not null,
    search_hash text not null
  ) strict;
`;

/**
 * 2: notes_fts_rows maps each note to its search row, so replacing a note's
 * search entry is a lookup instead of a scan of the whole index.
 * 3: it also keeps a hash of the indexed text, so saves that leave the text
 * alone (moves into folders, reordering) skip re-indexing.
 * 4: records no longer carry a version number.
 */
const SCHEMA_VERSION = 4;
const SEARCH_ROWS_VERSION = 3;

const SNAPSHOT_YIELD_EVERY = 200;

const hashSearchFields = ({ title, text }: StorageNoteSearchFields) =>
  createHash("sha1").update(title).update("\u0000").update(text).digest("base64");

type RecordRow = { id: string; value: string };

const readSearchFields = (value: unknown): StorageNoteSearchFields | null => {
  if (!value || typeof value !== "object") return null;
  const { title, text } = value as Partial<StorageNoteSearchFields>;
  return typeof title === "string" && typeof text === "string" ? { title, text } : null;
};

/** Each word becomes a quoted prefix term, so user input never reaches FTS syntax. */
export const buildFtsQuery = (query: string) =>
  query
    .split(/\s+/)
    .map((term) => term.replace(/"/g, "").trim())
    .filter(Boolean)
    .map((term) => `"${term}"*`)
    .join(" ");

/**
 * Stores every collection in one SQLite table and mirrors `notes` records into
 * an FTS5 index. Uses Node's built-in `node:sqlite`, so Electron needs no
 * native rebuild.
 */
export function createSqliteStorageAdapter(filename: string): StorageAdapter {
  const db = new DatabaseSync(filename);
  db.exec("pragma journal_mode = wal; pragma synchronous = normal; pragma busy_timeout = 5000;");
  db.exec(SCHEMA);
  // Older databases get a fresh search index, rebuilt once below; the row
  // map's shape changes first, before any statement that uses it is prepared.
  const { user_version: schemaVersion } = db.prepare("pragma user_version").get() as {
    user_version: number;
  };
  const needsSearchRebuild = schemaVersion < SEARCH_ROWS_VERSION;
  if (needsSearchRebuild)
    db.exec(`
      delete from notes_fts;
      drop table notes_fts_rows;
      create table notes_fts_rows (
        id text primary key,
        fts_rowid integer not null,
        search_hash text not null
      ) strict;
    `);

  const columns = db.prepare("select name from pragma_table_info('records')").all() as Array<{
    name: string;
  }>;
  if (columns.some((column) => column.name === "version"))
    db.exec("alter table records drop column version");

  const selectOne = db.prepare("select id, value from records where collection = ? and id = ?");
  const selectAll = db.prepare("select id, value from records where collection = ? order by id");
  const upsert = db.prepare(
    `insert into records (collection, id, value) values (?, ?, ?)
     on conflict (collection, id) do update set value = excluded.value`,
  );
  const remove = db.prepare("delete from records where collection = ? and id = ?");
  const selectFtsRow = db.prepare("select fts_rowid, search_hash from notes_fts_rows where id = ?");
  const removeFtsByRowid = db.prepare("delete from notes_fts where rowid = ?");
  const removeFtsRow = db.prepare("delete from notes_fts_rows where id = ?");
  const insertFts = db.prepare("insert into notes_fts (id, title, text) values (?, ?, ?)");
  const insertFtsRow = db.prepare(
    "insert into notes_fts_rows (id, fts_rowid, search_hash) values (?, ?, ?)",
  );
  const search = db.prepare(
    `select id from notes_fts where notes_fts match ?
     order by bm25(notes_fts, 0, 10.0, 1.0), id limit ? offset ?`,
  );

  const toRecord = (row: RecordRow): StoredRecord => ({
    id: row.id,
    value: JSON.parse(row.value) as unknown,
  });

  const indexNote = (id: string, value: unknown) => {
    const existing = selectFtsRow.get(id) as { fts_rowid: number; search_hash: string } | undefined;
    const fields = value === undefined ? null : readSearchFields(value);
    const hash = fields ? hashSearchFields(fields) : null;
    if (existing && existing.search_hash === hash) return;
    if (existing) {
      removeFtsByRowid.run(existing.fts_rowid);
      removeFtsRow.run(id);
    }
    if (!fields || !hash) return;
    const { lastInsertRowid } = insertFts.run(id, fields.title, fields.text);
    insertFtsRow.run(id, lastInsertRowid, hash);
  };

  if (needsSearchRebuild) {
    db.exec("begin immediate");
    try {
      for (const row of selectAll.all("notes") as RecordRow[])
        indexNote(row.id, JSON.parse(row.value));
      db.exec("commit");
    } catch (error) {
      db.exec("rollback");
      throw error;
    }
  }
  if (schemaVersion < SCHEMA_VERSION) db.exec(`pragma user_version = ${SCHEMA_VERSION}`);

  return {
    name: "sqlite",
    async get(collection: string, id: string) {
      const row = selectOne.get(collection, id) as RecordRow | undefined;
      return row ? toRecord(row) : null;
    },
    async list(collection: string) {
      return (selectAll.all(collection) as RecordRow[]).map(toRecord);
    },
    async commit(writes: readonly StorageWrite<string>[]) {
      // DatabaseSync is synchronous, so nothing else runs between begin and commit.
      db.exec("begin immediate");
      try {
        for (const write of writes) {
          if (write.type === "put")
            upsert.run(write.collection, write.id, JSON.stringify(write.value));
          else remove.run(write.collection, write.id);
          if (write.collection === "notes")
            indexNote(write.id, write.type === "put" ? write.value : undefined);
        }
        db.exec("commit");
      } catch (error) {
        db.exec("rollback");
        throw error;
      }
    },
    async searchNotes(query: string, limit: number, offset = 0): Promise<StorageSearchHit[]> {
      const match = buildFtsQuery(query);
      if (!match) return [];
      return search.all(match, limit, offset) as StorageSearchHit[];
    },
    async *readSnapshot() {
      // A second connection: its read transaction sees one consistent state
      // (WAL keeps it stable) while this connection goes on writing.
      const reader = new DatabaseSync(filename, { readOnly: true });
      try {
        reader.exec("begin");
        const rows = reader
          .prepare("select collection, id, value from records order by collection, id")
          .iterate() as Iterable<{ collection: string; id: string; value: string }>;
        let count = 0;
        for (const row of rows) {
          yield { collection: row.collection, id: row.id, json: row.value };
          // Let saves and window requests run while a large library streams.
          if (++count % SNAPSHOT_YIELD_EVERY === 0)
            await new Promise((resolve) => setImmediate(resolve));
        }
        reader.exec("commit");
      } finally {
        reader.close();
      }
    },
    async compact() {
      // A removed search entry leaves its words in the index's own pages until
      // the index is rebuilt; encryption relies on none being left behind.
      db.exec("insert into notes_fts(notes_fts) values('rebuild')");
      db.exec("vacuum");
      // A backup's reader can hold the log open for a moment; wait for it.
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const { busy } = db.prepare("pragma wal_checkpoint(truncate)").get() as { busy: number };
        if (!busy) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("The database is busy; its old contents could not be cleared.");
    },
    async close() {
      db.close();
    },
  };
}

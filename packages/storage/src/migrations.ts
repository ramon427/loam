import type { NoteContent } from "@loam/shared/notes/noteModel";
import { isRecord } from "@loam/shared/utils/isRecord";

import type { StorageAdapter, StorageWrite } from "./adapter";
import { readNoteContent, splitTitle, type TrashedNote } from "./noteContent";
import { listRecords, readRecord } from "./records";

/**
 * Upgrades of stored data, run each time a store opens, so a backup restored
 * from an older version is converted too. `meta/schema` holds the version:
 *
 * 2: notes are plain records. Before it, every note sat inside a sync
 *    envelope (the protocol of the server-backed app Loam was forked
 *    from), beside receipts, tombstones and cache tokens only that protocol read.
 * 3: deleted notes are in `trash`. Before it (v0.1.0), a deleted note's
 *    content was only its newest version in history.
 */
const STORE_SCHEMA_VERSION = 3;
const SCHEMA_ID = "schema";
const LEGACY_COLLECTIONS = ["tombstones", "receipts"];

const schemaWrite = (version: number): StorageWrite => ({
  type: "put",
  collection: "meta",
  id: SCHEMA_ID,
  value: { version },
});

/** A note from its old envelope payload, or null when it holds no note. */
const fromLegacyNote = (payload: unknown): NoteContent | null => {
  if (!isRecord(payload) || payload.kind !== "notes" || !Array.isArray(payload.tabs)) return null;
  const tabs = payload.tabs.filter(isRecord);
  if (tabs.length === 0) return null;
  const blocksByTab = isRecord(payload.blocksByTab) ? payload.blocksByTab : {};
  const activeTabId = tabs.some((tab) => tab.id === payload.activeTabId)
    ? payload.activeTabId
    : tabs[0]!.id;
  try {
    return readNoteContent({
      title: typeof payload.title === "string" ? payload.title : "",
      tabs: tabs.map(({ id, title, kind }) => ({ id, title, kind })),
      blocksByTab: Object.fromEntries(
        tabs.map((tab) => [tab.id, blocksByTab[String(tab.id)] ?? tab.blocks ?? []]),
      ),
      activeTabId,
      graphsByTab: payload.graphsByTab ?? {},
      tablesByTab: payload.tablesByTab ?? {},
      ...(payload.video ? { video: payload.video } : {}),
      ...(payload.graph ? { graph: payload.graph } : {}),
    });
  } catch {
    return null;
  }
};

/** Schema 2: notes out of their envelopes, and the old protocol's records gone. */
async function unwrapEnvelopes(adapter: StorageAdapter) {
  const writes: StorageWrite<string>[] = [];
  const put = (collection: string, id: string, value: unknown) =>
    writes.push({ type: "put", collection, id, value });
  const remove = (collection: string, id: string) =>
    writes.push({ type: "delete", collection, id });

  const rows = new Map((await listRecords(adapter, "notes")).map((row) => [row.id, row.value]));
  for (const record of await adapter.list("documents")) {
    if (!record.id.includes(":")) continue;
    remove("documents", record.id);
    if (!record.id.startsWith("note:")) continue;
    const noteId = record.id.slice("note:".length);
    const envelope = isRecord(record.value) ? record.value : {};
    const note = envelope.deletedAt == null ? fromLegacyNote(envelope.payload) : null;
    const row = rows.get(noteId);
    if (!note || !row) {
      if (row) remove("notes", noteId);
      continue;
    }
    const { title, content } = splitTitle(note);
    put("documents", noteId, content);
    if (row.title !== title) put("notes", noteId, { ...row, title });
  }
  for (const record of await listRecords(adapter, "revisions")) {
    const note = fromLegacyNote(record.value.document);
    // Already plain (no envelope kind) or unreadable: keep plain ones, drop the rest.
    if (note) put("revisions", record.id, { ...record.value, document: note });
    else if (isRecord(record.value.document) && "kind" in record.value.document)
      remove("revisions", record.id);
  }
  for (const collection of LEGACY_COLLECTIONS)
    for (const record of await adapter.list(collection)) remove(collection, record.id);
  for (const record of await adapter.list("meta"))
    if (record.id !== SCHEMA_ID) remove("meta", record.id);
  writes.push(schemaWrite(2));

  await adapter.commit(writes);
  // The old format held every note twice; give that space back once.
  await adapter.compact?.();
}

/** Schema 3: each note deleted before Trash existed goes to Trash, from its newest version. */
async function recoverTrash(adapter: StorageAdapter) {
  const [rows, trash] = await Promise.all([adapter.list("notes"), adapter.list("trash")]);
  const present = new Set([...rows, ...trash].map((record) => record.id));
  const writes: StorageWrite[] = [];
  for (const history of await listRecords(adapter, "history")) {
    const noteId = history.id;
    const newest = history.value.versions[0];
    if (present.has(noteId) || !newest) continue;
    const revision = await readRecord(adapter, "revisions", newest.id);
    if (!revision || revision.noteId !== noteId) continue;
    const trashed: TrashedNote = {
      note: {
        ...revision.document,
        id: noteId,
        updatedAt: new Date(newest.savedAt).toISOString(),
        contentState: "full",
      },
      deletedAt: newest.capturedAt,
    };
    writes.push({ type: "put", collection: "trash", id: noteId, value: trashed });
  }
  writes.push(schemaWrite(3));
  await adapter.commit(writes);
}

/** Brings stored data to the current schema; each step is one commit. */
export async function migrateStore(adapter: StorageAdapter): Promise<void> {
  const schema = (await adapter.get("meta", SCHEMA_ID))?.value;
  const version = isRecord(schema) && typeof schema.version === "number" ? schema.version : 0;
  if (version >= STORE_SCHEMA_VERSION) return;
  if (version < 2) await unwrapEnvelopes(adapter);
  await recoverTrash(adapter);
}

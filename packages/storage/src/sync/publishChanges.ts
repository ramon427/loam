import { toNoteContent, toPlacement } from "../noteContent";
import type { RemoteApplyStore } from "./applyRemote";
import { parseSyncKey, syncKey, type SyncChange, type SyncDocKey } from "./syncDocs";

/** What publishing reads of the store: its documents as they are now, and the ledger. */
type PublishStore = Pick<
  RemoteApplyStore,
  "ledger" | "now" | "findNote" | "readRows" | "readFolders" | "readProjects"
>;

/** Every document the store knows, deleted ones too: what publishing everything again sends. */
export const allSyncKeys = async (store: PublishStore) => {
  const [rows, folders, projects] = await Promise.all([
    store.readRows(),
    store.readFolders(),
    store.readProjects(),
  ]);
  const keys = new Set<SyncDocKey>(store.ledger.keys());
  for (const id of rows.keys()) keys.add(syncKey("note", id)).add(syncKey("place", id));
  for (const folder of folders) keys.add(syncKey("folder", folder.id));
  for (const project of projects) keys.add(syncKey("project", project.id));
  return keys;
};

/**
 * The current version of up to `limit` documents changed here and not yet
 * published; a deleted one's value is null. Load the ledger's records first.
 */
export const readUnpublishedChanges = async (store: PublishStore, limit: number) => {
  const [rows, folders, projects] = await Promise.all([
    store.readRows(),
    store.readFolders(),
    store.readProjects(),
  ]);
  const changes: SyncChange[] = [];
  for (const { key, record } of store.ledger.unpublished().slice(0, limit)) {
    const { kind, id } = parseSyncKey(key)!;
    const fields = {
      clock: record.clock,
      vector: record.vector,
      savedAt: store.now(),
      ...(record.overrode && { overrode: record.overrode }),
    };
    if (kind === "note") {
      const note = await store.findNote(id);
      const savedAt = note ? Date.parse(note.row.updatedAt) : fields.savedAt;
      const value = note && toNoteContent(note.row, note.content);
      changes.push({ ...fields, key: syncKey(kind, id), savedAt, value });
    } else if (kind === "place") {
      const row = rows.get(id);
      const value = row ? toPlacement(row) : null;
      changes.push({ ...fields, key: syncKey(kind, id), value });
    } else if (kind === "folder") {
      const folder = folders.find((entry) => entry.id === id);
      const value = folder
        ? { name: folder.name, position: folder.position, projectId: folder.projectId }
        : null;
      changes.push({ ...fields, key: syncKey(kind, id), value });
    } else {
      const project = projects.find((entry) => entry.id === id);
      const value = project
        ? { name: project.name, position: project.position, icon: project.icon }
        : null;
      changes.push({ ...fields, key: syncKey(kind, id), value });
    }
  }
  return changes;
};

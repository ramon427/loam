import type { BridgeImportNote } from "@loam/shared/bridge/loamBridge";
import type { NotesStore } from "@loam/storage/NotesStore";
import { normalizeFolderName } from "@loam/storage/folders";

/** Where an imported note goes once every note in the import exists. */
export type ImportedNotePlacement = { id: string; folder: string | null };

/**
 * Creates imported notes at the top level, in one commit per call. Every
 * note must be new: an import never changes a note that already exists.
 */
export async function writeImportedNotes(
  store: NotesStore,
  notes: readonly BridgeImportNote[],
  options: { external?: boolean } = {},
): Promise<ImportedNotePlacement[]> {
  await store.createNotes(
    notes.map(({ folder: _folder, ...note }) => ({ ...note, folderId: null })),
    options,
  );
  return notes.map((note) => ({
    id: note.id,
    folder: typeof note.folder === "string" ? note.folder : null,
  }));
}

const readFolderName = (name: string | null) => (name && normalizeFolderName(name)) || null;

/**
 * Moves imported notes into their folders with one layout save. A folder
 * whose name matches an existing one (ignoring case) is reused; the rest are
 * created after the existing folders. Existing notes keep their places.
 */
export async function placeImportedNotes(
  store: NotesStore,
  placements: readonly ImportedNotePlacement[],
  createId: () => string,
  options: { external?: boolean } = {},
): Promise<{ folderCount: number }> {
  const library = await store.getLibrary();
  const folders = library.folders.map(({ id, name }) => ({ id, name }));
  const folderIdByName = new Map(folders.map((folder) => [folder.name.toLowerCase(), folder.id]));
  let createdFolders = 0;
  const folderIdFor = (name: string | null) => {
    const folderName = readFolderName(name);
    if (!folderName) return null;
    const existing = folderIdByName.get(folderName.toLowerCase());
    if (existing) return existing;
    const id = createId();
    folders.push({ id, name: folderName });
    folderIdByName.set(folderName.toLowerCase(), id);
    createdFolders += 1;
    return id;
  };

  const imported = new Set(placements.map((placement) => placement.id));
  await store.saveLayout(
    {
      folders,
      notes: [
        ...library.notes
          .filter((note) => !imported.has(note.id))
          .map((note) => ({ id: note.id, folderId: note.folderId ?? null })),
        ...placements.map((placement) => ({
          id: placement.id,
          folderId: folderIdFor(placement.folder),
        })),
      ],
    },
    options,
  );
  return { folderCount: createdFolders };
}

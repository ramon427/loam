import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { NoteFolder } from "@loam/shared/notes/noteModel";
import { createUuid } from "@loam/shared/utils/uuid";
import { sortByPosition } from "../lib/sortByPosition";

import { readLibrary } from "./notesLibrary";
import type { NoteDocument } from "./types";
import type { LibraryLayout } from "./useLibraryLayout";

/** Adding, renaming, deleting and restoring folders. */
export function useFolderCommands({ saveLayout }: LibraryLayout) {
  const queryClient = useQueryClient();
  // Notes a folder held when it was deleted, so undo can put them back.
  const deletedFolderChildren = useRef(new Map<string, string[]>());

  const createFolder = useCallback(
    async (name: string, projectId?: string) => {
      const library = readLibrary(queryClient);
      const folder: NoteFolder = {
        id: createUuid(),
        name,
        position: library.folders.length,
        ...(projectId ? { projectId } : {}),
      };
      await saveLayout({ ...library, folders: [...library.folders, folder] }, "Folder not created");
      return folder;
    },
    [queryClient, saveLayout],
  );

  const renameFolder = useCallback(
    async (folderId: string, name: string) => {
      const library = readLibrary(queryClient);
      await saveLayout(
        {
          ...library,
          folders: library.folders.map((folder) =>
            folder.id === folderId ? { ...folder, name } : folder,
          ),
        },
        "Folder not renamed",
      );
    },
    [queryClient, saveLayout],
  );

  const removeFolders = useCallback(
    async (folderIds: ReadonlySet<string>, failure: string) => {
      const library = readLibrary(queryClient);
      for (const folderId of folderIds)
        deletedFolderChildren.current.set(
          folderId,
          library.notes.filter((note) => note.folderId === folderId).map((note) => note.id),
        );
      const removed = library.folders.filter((folder) => folderIds.has(folder.id));
      const projectOf = new Map(removed.map((folder) => [folder.id, folder.projectId]));
      // A deleted folder's notes stay in its project, outside folders.
      await saveLayout(
        {
          ...library,
          notes: library.notes.map((note) =>
            note.folderId && folderIds.has(note.folderId)
              ? { ...note, folderId: undefined, projectId: projectOf.get(note.folderId) }
              : note,
          ),
          folders: library.folders.filter((folder) => !folderIds.has(folder.id)),
        },
        failure,
      );
      return removed;
    },
    [queryClient, saveLayout],
  );

  const deleteFolder = useCallback(
    async (folderId: string) =>
      (await removeFolders(new Set([folderId]), "Folder not deleted"))[0] ?? null,
    [removeFolders],
  );

  const restoreFolder = useCallback(
    async (folder: NoteFolder) => {
      const library = readLibrary(queryClient);
      const children = new Set(deletedFolderChildren.current.get(folder.id) ?? []);
      deletedFolderChildren.current.delete(folder.id);
      const ordered = sortByPosition(library.folders);
      ordered.splice(Math.min(folder.position, ordered.length), 0, folder);
      // Children return only if they are still where the delete left them; a later move wins.
      const leftWhereDeleted = (note: NoteDocument) =>
        children.has(note.id) && !note.folderId && note.projectId === folder.projectId;
      await saveLayout(
        {
          ...library,
          notes: library.notes.map((note) =>
            leftWhereDeleted(note) ? { ...note, folderId: folder.id, projectId: undefined } : note,
          ),
          folders: ordered.map((entry, position) => ({ ...entry, position })),
        },
        "Folder not restored",
      );
    },
    [queryClient, saveLayout],
  );

  return { createFolder, renameFolder, removeFolders, deleteFolder, restoreFolder };
}

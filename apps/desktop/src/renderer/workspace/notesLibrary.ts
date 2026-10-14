import type { QueryClient } from "@tanstack/react-query";

import type {
  NotesBootstrap,
  NotesLayout,
  NoteFolder,
  NoteProject,
} from "@loam/shared/notes/noteModel";
import { callBridge } from "../bridge";
import { sortByPosition } from "../lib/sortByPosition";

import { saveEditsFromLastSession } from "./noteSaves";
import type { NoteDocument } from "./types";

export const LIBRARY_KEY = ["notes-library"] as const;
export const noteKey = (noteId: string) => ["note", noteId] as const;

export type Library = { notes: NoteDocument[]; folders: NoteFolder[]; projects: NoteProject[] };

export const EMPTY_LIBRARY: Library = { notes: [], folders: [], projects: [] };

let lastSessionEdits: Promise<void> | null = null;

/** Edits a previous session didn't finish saving are saved before any note is read. */
export const afterLastSessionEdits = () => (lastSessionEdits ??= saveEditsFromLastSession());

export const toLibrary = (library: NotesBootstrap): Library => ({
  notes: library.notes as NoteDocument[],
  folders: library.folders,
  projects: library.projects,
});

export const loadLibrary = async (): Promise<Library> => {
  await afterLastSessionEdits();
  return toLibrary(await callBridge("notes.library", {}));
};

/** Everything in order, each folder and note in its place. */
export const toLayout = ({ notes, folders, projects }: Library): NotesLayout => ({
  projects: sortByPosition(projects).map(({ id, name, icon }) => ({ id, name, icon })),
  folders: sortByPosition(folders).map(({ id, name, projectId }) => ({
    id,
    name,
    projectId: projectId ?? null,
  })),
  notes: sortByPosition(notes).map(({ id, folderId, projectId }) => ({
    id,
    folderId: folderId ?? null,
    projectId: folderId ? null : (projectId ?? null),
  })),
});

export const readLibrary = (queryClient: QueryClient) =>
  queryClient.getQueryData<Library>(LIBRARY_KEY) ?? EMPTY_LIBRARY;

/**
 * Drops a note that no longer exists from the cache. A note still on screen
 * (open, or watched by a live snapshot) reads as gone instead, so it doesn't
 * load again.
 */
export const dropNoteQuery = (queryClient: QueryClient, noteId: string) => {
  if (
    queryClient
      .getQueryCache()
      .find({ queryKey: noteKey(noteId) })
      ?.isActive()
  )
    queryClient.setQueryData(noteKey(noteId), null);
  else queryClient.removeQueries({ queryKey: noteKey(noteId) });
};

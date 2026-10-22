import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";

import type { NoteFolder, NoteProject, NoteProjectIcon } from "@loam/shared/notes/noteModel";
import { callBridge } from "../host/notesHost";
import type { HistoryTarget } from "../history/NoteHistoryDialog";

import {
  keepUnsavedEditsOnClose,
  noteRead,
  saveNoteEdits,
  withUnsavedEdits,
  type NoteField,
} from "./noteSaves";
import {
  afterLastSessionEdits,
  LIBRARY_KEY,
  loadLibrary,
  noteKey,
  type Library,
} from "./notesLibrary";
import type { NoteDocument, NotesDeleteSelectionInput, NotesDeleteSelectionResult } from "./types";
import { useFolderCommands } from "./useFolderCommands";
import { useLibraryLayout } from "./useLibraryLayout";
import { useNoteCommands } from "./useNoteCommands";
import { useOpenNote } from "./useOpenNote";
import { useProjectCommands } from "./useProjectCommands";
import { useSyncedChanges } from "./useSyncedChanges";

/**
 * Where a new note goes: a folder, else inside another note as its sub-note, else a
 * project's own notes, else the top level.
 */
export type NewNotePlace = { folderId?: string; projectId?: string; parentNoteId?: string };

/** What a project shows: its name and its icon (a default one when it has none). */
export type NoteProjectDetails = { name: string; icon?: NoteProjectIcon };

/** New values for some of a note's content; the fields named are the ones saved. */
export type NoteContentPatch = Partial<Pick<NoteDocument, NoteField>>;

/** A request to open a note at one of its tabs, or with its title ready to type. */
export type NoteOpenRequest = { id: number; noteId: string; tabId?: string; focusTitle?: boolean };

export type NotesWorkspace = {
  notes: NoteDocument[];
  folders: NoteFolder[];
  projects: NoteProject[];
  isLoading: boolean;
  loadError: unknown;
  reloadLibrary: () => void;
  /** Reads a note again after it changed outside its editors, as a restored version does. */
  reloadNote: (noteId: string) => void;
  /** The open note, or null when none is. */
  activeNoteId: string | null;
  /** The latest request to open a note; the open note applies it once, by its id. */
  openRequest: NoteOpenRequest | null;
  /** Goes up when sync replaces the open note's content, so its editor starts over. */
  activeNoteRevision: number;
  openNote: (noteId: string, options?: { tabId?: string; focusTitle?: boolean }) => void;
  /** The note whose version history is open, or null. */
  historyTarget: HistoryTarget | null;
  /** Opens a note's version history, at one version when `target` names it; null closes it. */
  openHistory: (target: HistoryTarget | null) => void;
  /**
   * Changes a note read in full and saves the fields `change` names after a
   * short pause. A function gets the note as it is now, edits included.
   */
  updateNote: (
    noteId: string,
    change: NoteContentPatch | ((note: NoteDocument) => NoteContentPatch),
  ) => void;
  /**
   * Adds a note, empty or holding `draft`'s content, and opens it. A sub-note is linked from
   * the end of its parent's page.
   */
  createNote: (place?: NewNotePlace, draft?: NoteDocument) => Promise<NoteDocument | null>;
  /** Copies a note with all its tabs and its video, right after it, and opens the copy. */
  duplicateNote: (noteId: string, title: string) => Promise<NoteDocument | null>;
  /** Adds a folder at the end of a project, or of the top level. */
  createFolder: (name: string, projectId?: string) => Promise<NoteFolder | null>;
  /** Adds a project after the others. */
  createProject: (details: NoteProjectDetails) => Promise<NoteProject | null>;
  updateProject: (projectId: string, details: NoteProjectDetails) => Promise<void>;
  renameNote: (noteId: string, title: string) => void;
  renameFolder: (folderId: string, name: string) => Promise<void>;
  deleteNote: (noteId: string) => Promise<NoteDocument | null>;
  restoreNote: (note: NoteDocument, options?: { focus?: boolean }) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<NoteFolder | null>;
  restoreFolder: (folder: NoteFolder) => Promise<void>;
  deleteSelection: (selection: NotesDeleteSelectionInput) => Promise<NotesDeleteSelectionResult>;
  /**
   * Saves new places and order for notes, folders or projects; what `change` leaves out stays
   * as it is. A project left out of `change.projects` is removed.
   */
  rearrange: (change: Partial<Library>, failure: string) => Promise<void>;
};

const NotesWorkspaceContext = createContext<NotesWorkspace | null>(null);

export const useNotesWorkspace = () => {
  const workspace = use(NotesWorkspaceContext);
  if (!workspace) throw new Error("useNotesWorkspace needs a NotesWorkspaceProvider.");
  return workspace;
};

/** The open note in full: the store's copy plus the edits made since. */
export const useNoteDocument = (noteId: string | null) =>
  useQuery({
    queryKey: noteKey(noteId ?? ""),
    queryFn: async () => {
      await afterLastSessionEdits();
      // A rename from the sidebar reaches the store before the note is read;
      // edits that can't be saved yet are laid over what is read.
      await saveNoteEdits(noteId!).catch(() => undefined);
      const note = (await callBridge("notes.get", { noteId: noteId! })) as NoteDocument;
      noteRead(note);
      return withUnsavedEdits(note);
    },
    enabled: Boolean(noteId),
    // Local edits live in this cache entry; a refetch would drop them.
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
    retry: false,
  });

/** Owns the notes library, the open note and every change to them. */
export function NotesWorkspaceProvider({ children }: { children: ReactNode }) {
  const library = useQuery({
    queryKey: LIBRARY_KEY,
    queryFn: loadLibrary,
    staleTime: Infinity,
  });
  const { activeNoteId, openRequest, openNote, leaveDeletedNotes } = useOpenNote(library.data);
  const layout = useLibraryLayout();
  const { rearrange } = layout;
  const {
    updateNote,
    createNote,
    duplicateNote,
    renameNote,
    deleteNote,
    deleteNotes,
    restoreNote,
  } = useNoteCommands({ layout, openNote, leaveDeletedNotes });
  const { createFolder, renameFolder, removeFolders, deleteFolder, restoreFolder } =
    useFolderCommands(layout);
  const { createProject, updateProject } = useProjectCommands(layout);
  const [historyTarget, openHistory] = useState<HistoryTarget | null>(null);
  const { activeNoteRevision, reloadNote } = useSyncedChanges({
    activeNoteId,
    openHistory,
    leaveDeletedNotes,
    recover: layout.recover,
  });

  // Edits not yet saved are kept for the next launch; ask only if they can't be.
  useEffect(() => {
    const keepEdits = (event: BeforeUnloadEvent) => {
      if (!keepUnsavedEditsOnClose()) event.preventDefault();
    };
    window.addEventListener("beforeunload", keepEdits);
    return () => window.removeEventListener("beforeunload", keepEdits);
  }, []);

  const deleteSelection = useCallback(
    async ({ noteIds, folderIds }: NotesDeleteSelectionInput) => {
      const notes = await deleteNotes(noteIds);
      const folders = folderIds.length
        ? await removeFolders(new Set(folderIds), "Folders not deleted")
        : [];
      return { notes, folders };
    },
    [deleteNotes, removeFolders],
  );

  const value = useMemo<NotesWorkspace>(
    () => ({
      notes: library.data?.notes ?? [],
      folders: library.data?.folders ?? [],
      projects: library.data?.projects ?? [],
      isLoading: library.isPending,
      loadError: library.error,
      reloadLibrary: () => void library.refetch(),
      reloadNote,
      activeNoteId,
      openRequest,
      activeNoteRevision,
      openNote,
      historyTarget,
      openHistory,
      updateNote,
      createNote,
      duplicateNote,
      createFolder,
      createProject,
      updateProject,
      renameNote,
      renameFolder,
      deleteNote,
      restoreNote,
      deleteFolder,
      restoreFolder,
      deleteSelection,
      rearrange,
    }),
    [
      library,
      reloadNote,
      activeNoteId,
      openRequest,
      activeNoteRevision,
      openNote,
      historyTarget,
      updateNote,
      createNote,
      duplicateNote,
      createFolder,
      createProject,
      updateProject,
      renameNote,
      renameFolder,
      deleteNote,
      restoreNote,
      deleteFolder,
      restoreFolder,
      deleteSelection,
      rearrange,
    ],
  );

  return <NotesWorkspaceContext value={value}>{children}</NotesWorkspaceContext>;
}

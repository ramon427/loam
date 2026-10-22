import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { createUuid } from "@loam/shared/utils/uuid";
import { callBridge } from "../host/notesHost";
import { forgetBesideTab } from "../files/useBesideTab";
import { forgetVideoView } from "../video/useVideoPane";

import { createNoteDocument } from "./noteDocuments";
import {
  discardNoteEdits,
  noteRead,
  recordNoteEdit,
  saveNoteEdits,
  withUnsavedEdits,
  type NoteField,
} from "./noteSaves";
import { dropNoteQuery, LIBRARY_KEY, noteKey, readLibrary } from "./notesLibrary";
import type { NewNotePlace, NoteContentPatch, NotesWorkspace } from "./NotesWorkspace";
import { withRenamedSubNoteLinks, withSubNoteLink } from "./subNoteLinks";
import type { NoteDocument } from "./types";
import type { LibraryLayout } from "./useLibraryLayout";

/** Adding, changing, copying, deleting and restoring notes. */
export function useNoteCommands({
  layout: { setLibrary, recover, saveLayout },
  openNote,
  leaveDeletedNotes,
}: {
  layout: LibraryLayout;
  openNote: NotesWorkspace["openNote"];
  leaveDeletedNotes: (deletedIds: ReadonlySet<string>) => void;
}) {
  const queryClient = useQueryClient();

  const showTitleInLibrary = useCallback(
    (noteId: string, title: string) =>
      setLibrary((current) => ({
        ...current,
        notes: current.notes.map((entry) => (entry.id === noteId ? { ...entry, title } : entry)),
      })),
    [setLibrary],
  );

  const readFullNote = useCallback(
    (noteId: string) => {
      const note = queryClient.getQueryData<NoteDocument | null>(noteKey(noteId));
      return note?.contentState === "full" ? note : null;
    },
    [queryClient],
  );

  /** Changes a note read in full and records the fields changed for saving. */
  const applyPatch = useCallback(
    (current: NoteDocument, patch: NoteContentPatch) => {
      const next = { ...current, ...patch };
      queryClient.setQueryData(noteKey(current.id), next);
      recordNoteEdit(next, Object.keys(patch) as NoteField[]);
      return next;
    },
    [queryClient],
  );

  /**
   * Shows a new title in the library, and in the links to the note its parent holds, while
   * the parent is read in full.
   */
  const retitle = useCallback(
    (noteId: string, previous: string, title: string) => {
      showTitleInLibrary(noteId, title);
      const { parentNoteId } =
        readLibrary(queryClient).notes.find((note) => note.id === noteId) ?? {};
      const parent = parentNoteId ? readFullNote(parentNoteId) : null;
      const blocksByTab = parent && withRenamedSubNoteLinks(parent, noteId, previous, title);
      if (parent && blocksByTab) applyPatch(parent, { blocksByTab });
    },
    [applyPatch, queryClient, readFullNote, showTitleInLibrary],
  );

  const updateNote = useCallback(
    (noteId: string, change: NoteContentPatch | ((note: NoteDocument) => NoteContentPatch)) => {
      const current = readFullNote(noteId);
      // The library lists summaries; only a note read in full can be changed.
      if (!current) return;
      const patch = typeof change === "function" ? change(current) : change;
      if (Object.keys(patch).length === 0) return;
      const next = applyPatch(current, patch);
      if ("title" in patch) retitle(noteId, current.title, next.title);
    },
    [applyPatch, readFullNote, retitle],
  );

  /** Links a new sub-note from the end of its parent's page, reading the parent first. */
  const linkFromParent = useCallback(
    async (parentNoteId: string, subNote: NoteDocument) => {
      if (!readFullNote(parentNoteId)) {
        await saveNoteEdits(parentNoteId).catch(() => undefined);
        const parent = (await callBridge("notes.get", { noteId: parentNoteId })) as NoteDocument;
        noteRead(parent);
        // Read while it loaded, the editor's copy wins.
        if (!readFullNote(parentNoteId))
          queryClient.setQueryData(noteKey(parentNoteId), withUnsavedEdits(parent));
      }
      updateNote(parentNoteId, (parent) => {
        const blocksByTab = withSubNoteLink(parent, subNote);
        return blocksByTab ? { blocksByTab } : {};
      });
    },
    [queryClient, readFullNote, updateNote],
  );

  const createNote = useCallback(
    async (
      { folderId, projectId, parentNoteId }: NewNotePlace = {},
      draft = createNoteDocument(""),
    ) => {
      try {
        const created = (await callBridge("notes.create", {
          note: {
            ...draft,
            folderId: folderId ?? null,
            projectId: projectId ?? null,
            parentNoteId: parentNoteId ?? null,
          },
        })) as NoteDocument;
        noteRead(created);
        queryClient.setQueryData(noteKey(created.id), created);
        setLibrary((current) => ({ ...current, notes: [...current.notes, created] }));
        if (created.parentNoteId)
          await linkFromParent(created.parentNoteId, created).catch(() => undefined);
        // A new empty note is named first; one made from something already has its name.
        openNote(created.id, { focusTitle: !created.title });
        return created;
      } catch (error) {
        recover("Note not created", error);
        return null;
      }
    },
    [linkFromParent, openNote, queryClient, recover, setLibrary],
  );

  const duplicateNote = useCallback(
    async (noteId: string, title: string) => {
      try {
        // The open note's cache holds edits not saved yet, and the copy keeps them.
        const cached = queryClient.getQueryData<NoteDocument | null>(noteKey(noteId));
        const source =
          cached?.contentState === "full"
            ? cached
            : ((await callBridge("notes.get", { noteId })) as NoteDocument);
        // Everything but the note's identity and place is copied, fields a newer version wrote too.
        const {
          id,
          folderId,
          projectId,
          parentNoteId,
          updatedAt: _updatedAt,
          contentState: _contentState,
          position: _position,
          ...content
        } = source;
        const created = (await callBridge("notes.create", {
          note: {
            ...structuredClone(content),
            id: createUuid(),
            title,
            folderId: folderId ?? null,
            projectId: projectId ?? null,
            parentNoteId: parentNoteId ?? null,
          },
        })) as NoteDocument;
        noteRead(created);
        queryClient.setQueryData(noteKey(created.id), created);
        // The store adds the copy at the end of the folder; it belongs right after the original.
        const library = readLibrary(queryClient);
        const original = library.notes.find((note) => note.id === id);
        const placed = { ...created, position: (original?.position ?? library.notes.length) + 0.5 };
        await saveLayout({ ...library, notes: [...library.notes, placed] }, "Note not moved");
        openNote(created.id);
        return created;
      } catch (error) {
        recover("Note not duplicated", error);
        return null;
      }
    },
    [openNote, queryClient, recover, saveLayout],
  );

  const renameNote = useCallback(
    (noteId: string, title: string) => {
      if (queryClient.getQueryData<NoteDocument | null>(noteKey(noteId))?.contentState === "full") {
        updateNote(noteId, { title });
        return;
      }
      const listed = readLibrary(queryClient).notes.find((entry) => entry.id === noteId);
      if (!listed) return;
      retitle(noteId, listed.title, title);
      // Only the title is saved from this summary; the body it lacks is never written.
      recordNoteEdit({ ...listed, title }, ["title"]);
    },
    [queryClient, retitle, updateNote],
  );

  const deleteNotes = useCallback(
    async (noteIds: readonly string[]) => {
      const ids = new Set(noteIds);
      leaveDeletedNotes(ids);
      // Sub-notes of a deleted note stay, in the place it was in.
      const listed = new Map(readLibrary(queryClient).notes.map((note) => [note.id, note]));
      const placeAfterDelete = (note: NoteDocument) => {
        let place: NoteDocument | undefined = note;
        while (place?.parentNoteId && ids.has(place.parentNoteId))
          place = listed.get(place.parentNoteId);
        const { folderId, projectId, parentNoteId } = place ?? {};
        return place === note ? note : { ...note, folderId, projectId, parentNoteId };
      };
      const movesSubNotes = [...listed.values()].some(
        (note) => note.parentNoteId && ids.has(note.parentNoteId) && !ids.has(note.id),
      );
      setLibrary((current) => ({
        ...current,
        notes: current.notes.filter((note) => !ids.has(note.id)).map(placeAfterDelete),
      }));
      const deleted: NoteDocument[] = [];
      for (const noteId of ids) {
        try {
          // Trash must hold the last words the user typed, including pending edits.
          await saveNoteEdits(noteId);
          deleted.push((await callBridge("notes.delete", { noteId })) as NoteDocument);
          discardNoteEdits(noteId);
          void queryClient.invalidateQueries({ queryKey: ["notes-trash"] });
          dropNoteQuery(queryClient, noteId);
          forgetVideoView(noteId);
          forgetBesideTab(noteId);
        } catch (error) {
          recover("Note not deleted", error);
        }
      }
      // The store numbers the sub-notes it moved; the library reads their places again.
      if (movesSubNotes) await queryClient.invalidateQueries({ queryKey: LIBRARY_KEY });
      return deleted;
    },
    [leaveDeletedNotes, queryClient, recover, setLibrary],
  );

  const deleteNote = useCallback(
    async (noteId: string) => (await deleteNotes([noteId]))[0] ?? null,
    [deleteNotes],
  );

  const restoreNote = useCallback(
    async (note: NoteDocument, { focus = false }: { focus?: boolean } = {}) => {
      try {
        const restored = await callBridge("notes.restore", { note });
        noteRead(restored);
        queryClient.setQueryData(noteKey(note.id), restored);
        void queryClient.invalidateQueries({ queryKey: ["notes-trash"] });
        await queryClient.invalidateQueries({ queryKey: LIBRARY_KEY });
        if (focus) openNote(note.id);
      } catch (error) {
        recover("Note not restored", error);
      }
    },
    [openNote, queryClient, recover],
  );

  return {
    updateNote,
    createNote,
    duplicateNote,
    renameNote,
    deleteNote,
    deleteNotes,
    restoreNote,
  };
}

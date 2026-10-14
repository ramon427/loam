import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { createUuid } from "@loam/shared/utils/uuid";
import { callBridge } from "../bridge";
import { forgetBesideTab } from "../files/useBesideTab";
import { forgetVideoView } from "../video/useVideoPane";

import { createNoteDocument } from "./noteDocuments";
import {
  discardNoteEdits,
  noteRead,
  recordNoteEdit,
  saveNoteEdits,
  type NoteField,
} from "./noteSaves";
import { dropNoteQuery, LIBRARY_KEY, noteKey, readLibrary } from "./notesLibrary";
import type { NewNotePlace, NoteContentPatch, NotesWorkspace } from "./NotesWorkspace";
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

  const updateNote = useCallback(
    (noteId: string, change: NoteContentPatch | ((note: NoteDocument) => NoteContentPatch)) => {
      const current = queryClient.getQueryData<NoteDocument | null>(noteKey(noteId));
      // The library lists summaries; only a note read in full can be changed.
      if (current?.contentState !== "full") return;
      const patch = typeof change === "function" ? change(current) : change;
      const fields = Object.keys(patch) as NoteField[];
      if (fields.length === 0) return;
      const next = { ...current, ...patch };
      queryClient.setQueryData(noteKey(noteId), next);
      if ("title" in patch) showTitleInLibrary(noteId, next.title);
      recordNoteEdit(next, fields);
    },
    [queryClient, showTitleInLibrary],
  );

  const createNote = useCallback(
    async ({ folderId, projectId }: NewNotePlace = {}, draft = createNoteDocument("")) => {
      try {
        const created = (await callBridge("notes.create", {
          note: { ...draft, folderId: folderId ?? null, projectId: projectId ?? null },
        })) as NoteDocument;
        noteRead(created);
        queryClient.setQueryData(noteKey(created.id), created);
        setLibrary((current) => ({ ...current, notes: [...current.notes, created] }));
        // A new empty note is named first; one made from something already has its name.
        openNote(created.id, { focusTitle: !created.title });
        return created;
      } catch (error) {
        recover("Note not created", error);
        return null;
      }
    },
    [openNote, queryClient, recover, setLibrary],
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
      showTitleInLibrary(noteId, title);
      // Only the title is saved from this summary; the body it lacks is never written.
      recordNoteEdit({ ...listed, title }, ["title"]);
    },
    [queryClient, showTitleInLibrary, updateNote],
  );

  const deleteNotes = useCallback(
    async (noteIds: readonly string[]) => {
      const ids = new Set(noteIds);
      leaveDeletedNotes(ids);
      setLibrary((current) => ({
        ...current,
        notes: current.notes.filter((note) => !ids.has(note.id)),
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

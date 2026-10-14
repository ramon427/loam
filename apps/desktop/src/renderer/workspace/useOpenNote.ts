import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { onAppEvent } from "../lib/appEventBus";
import { readPreference, removePreference, writePreference } from "../lib/preferences";
import { sortByPosition } from "../lib/sortByPosition";
import { pluginHost } from "../plugins/host";
import { toastWarning } from "../ui/toast";

import { saveNoteEdits } from "./noteSaves";
import { noteKey, readLibrary, type Library } from "./notesLibrary";
import type { NoteOpenRequest } from "./NotesWorkspace";
import type { NoteDocument } from "./types";

/** The note open when the window last closed, which opens again at launch. */
const LAST_OPEN_NOTE_KEY = "last-open-note";

/** Which note is open, and the requests that open one. */
export function useOpenNote(library: Library | undefined) {
  const queryClient = useQueryClient();
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [openRequest, setOpenRequest] = useState<NoteOpenRequest | null>(null);
  const lastOpenRequestId = useRef(0);

  // The library loads once encrypted notes are unlocked; only a note still in it reopens.
  const sessionRestored = useRef(false);
  useEffect(() => {
    if (sessionRestored.current || !library) return;
    sessionRestored.current = true;
    const noteId = readPreference(LAST_OPEN_NOTE_KEY, (value) =>
      typeof value === "string" ? value : null,
    );
    if (noteId && library.notes.some((note) => note.id === noteId))
      setActiveNoteId((current) => current ?? noteId);
  }, [library]);
  useEffect(() => {
    if (!sessionRestored.current) return;
    if (activeNoteId) writePreference(LAST_OPEN_NOTE_KEY, activeNoteId);
    else removePreference(LAST_OPEN_NOTE_KEY);
  }, [activeNoteId]);

  // Leaving a note saves its edits right away instead of after the pause.
  const previousNoteId = useRef(activeNoteId);
  useEffect(() => {
    const previous = previousNoteId.current;
    previousNoteId.current = activeNoteId;
    if (previous && previous !== activeNoteId) void saveNoteEdits(previous).catch(() => undefined);
  }, [activeNoteId]);

  const openNote = useCallback(
    (noteId: string, options: { tabId?: string; focusTitle?: boolean } = {}) => {
      const open = () => {
        lastOpenRequestId.current += 1;
        setOpenRequest({ id: lastOpenRequestId.current, noteId, ...options });
        setActiveNoteId(noteId);
      };
      // Only a plugin hooking note.open costs the open a round trip to its worker.
      if (!pluginHost.hooks("note.open")) {
        open();
        return;
      }
      void pluginHost
        .dispatch("note.open", { noteId }, () => ({}))
        .then((result) => {
          const deny = (result as { deny?: unknown } | null)?.deny;
          if (typeof deny === "string" && deny.trim()) toastWarning(deny.slice(0, 300));
          else open();
        });
    },
    [],
  );

  /** Where the sidebar goes when the open note is deleted: the next note, else the previous. */
  const leaveDeletedNotes = useCallback(
    (deletedIds: ReadonlySet<string>) => {
      if (!activeNoteId || !deletedIds.has(activeNoteId)) return;
      const ordered = sortByPosition(readLibrary(queryClient).notes);
      const index = ordered.findIndex((note) => note.id === activeNoteId);
      const remaining = (note: NoteDocument) => !deletedIds.has(note.id);
      const next =
        ordered.slice(index + 1).find(remaining) ??
        ordered.slice(0, index).reverse().find(remaining);
      setActiveNoteId(next?.id ?? null);
    },
    [activeNoteId, queryClient],
  );

  // AI clients open notes and read which one is open through the window's automation.
  useEffect(() => {
    const stopOpening = onAppEvent("notes:open", ({ detail }) => {
      if (detail.noteId) openNote(detail.noteId, { tabId: detail.tabId });
      else setActiveNoteId(null);
    });
    const stopReading = onAppEvent("notes:read-open", ({ detail }) => {
      const open = activeNoteId
        ? queryClient.getQueryData<NoteDocument | null>(noteKey(activeNoteId))
        : null;
      detail.respond({ noteId: activeNoteId, tabId: open?.activeTabId ?? null });
    });
    return () => {
      stopOpening();
      stopReading();
    };
  }, [activeNoteId, openNote, queryClient]);

  return { activeNoteId, openRequest, openNote, leaveDeletedNotes };
}

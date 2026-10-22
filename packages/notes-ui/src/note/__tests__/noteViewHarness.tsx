import type { BlockNoteEditor } from "@blocknote/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { beforeAll, expect } from "vitest";

import type { LoamBridge } from "@loam/shared/bridge/loamBridge";
import type { NotePatch } from "@loam/shared/notes/noteModel";

import type { NoteDocument } from "../../workspace/types";
import {
  NotesWorkspaceProvider,
  useNotesWorkspace,
  type NotesWorkspace,
} from "../../workspace/NotesWorkspace";
import { NotesScreen } from "../NotesScreen";
import { configureNotesHost } from "../../host/notesHost";

/**
 * jsdom has no layout; BlockNote's menus and the note's panes only need some
 * boxes. The text editor loads lazily, so it is loaded once up front.
 */
export const stubLayout = () =>
  beforeAll(async () => {
    await import("../../editor/PageTabEditor");
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    Range.prototype.getClientRects = () => Object.assign([], { item: () => null });
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    window.matchMedia ??= (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList;
  });

/** A paragraph block with plain text. */
export const paragraph = (id: string, text: string) => ({
  id,
  type: "paragraph",
  content: [{ type: "text", text, styles: {} }],
});

/** A note with page tabs holding the given blocks; the first tab shows. */
export const textNote = (
  id: string,
  tabs: Record<string, unknown[]>,
  extra: Partial<NoteDocument> = {},
): NoteDocument => {
  const tabIds = Object.keys(tabs);
  return {
    id,
    title: "Course",
    updatedAt: "2026-01-01T00:00:00.000Z",
    tabs: tabIds.map((tabId, position) => ({ id: tabId, title: tabId, kind: "page", position })),
    blocksByTab: tabs as NoteDocument["blocksByTab"],
    activeTabId: tabIds[0]!,
    graphsByTab: {},
    tablesByTab: {},
    ...extra,
  };
};

/** The notes the app would keep in its store, answering the bridge like the main process. */
export const createStore = (notes: NoteDocument[]) => {
  const stored = new Map(notes.map((note) => [note.id, structuredClone(note)]));
  let clock = Date.parse("2026-02-01T00:00:00.000Z");
  const answer = (method: string, params: Record<string, unknown>) => {
    switch (method) {
      case "notes.library":
        return {
          folders: [],
          notes: [...stored.values()].map((note) => ({
            ...note,
            tabs: [],
            blocksByTab: {},
            contentState: "summary",
          })),
        };
      case "notes.get": {
        const note = stored.get(params.noteId as string);
        if (!note) throw Object.assign(new Error("Note not found."), { code: "NOT_FOUND" });
        return { ...structuredClone(note), contentState: "full" };
      }
      case "notes.save": {
        const note = stored.get(params.noteId as string)!;
        const { video, ...patch } = params.patch as NotePatch;
        const next: NoteDocument = { ...note, ...(patch as Partial<NoteDocument>) };
        if (video !== undefined) next.video = video ?? undefined;
        clock += 1000;
        next.updatedAt = new Date(clock).toISOString();
        stored.set(next.id, structuredClone(next));
        return { updatedAt: next.updatedAt };
      }
      case "notes.backlinks":
        return { notes: [], noteCount: 0 };
      default:
        return null;
    }
  };
  const bridge: LoamBridge = {
    invoke: (async (method: string, params: Record<string, unknown>) => {
      try {
        return { ok: true, data: answer(method, params) };
      } catch (error) {
        const code = (error as { code?: string }).code ?? "FAILED";
        return { ok: false, error: { code, message: String(error), status: 500 } };
      }
    }) as LoamBridge["invoke"],
    on: () => () => undefined,
    platform: "linux",
    pathForFile: () => "",
  };
  return { bridge, note: (id: string) => stored.get(id)! };
};

/** Renders the notes screen over `store` and opens `noteId`. */
export const renderNoteScreen = async (
  store: ReturnType<typeof createStore>,
  noteId: string,
  options: { tabId?: string } = {},
) => {
  window.loam = store.bridge;
  configureNotesHost(store.bridge);
  let workspace: NotesWorkspace | null = null;
  function ReadWorkspace() {
    workspace = useNotesWorkspace();
    return null;
  }
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <NotesWorkspaceProvider>
        <ReadWorkspace />
        <NotesScreen />
      </NotesWorkspaceProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(workspace!.isLoading).toBe(false));
  act(() => workspace!.openNote(noteId, options));
  await waitFor(() =>
    expect(view.container.querySelector("[data-note-title-field]")).not.toBeNull(),
  );
  return { ...view, workspace: () => workspace! };
};

type TiptapDom = HTMLElement & {
  editor?: { schema: { cached: { blockNoteEditor: BlockNoteEditor } } };
};

/** The BlockNote editor of the page tab on screen, once it has loaded. */
export const pageTabEditor = async (container: HTMLElement) =>
  waitFor(
    () => {
      const dom = container.querySelector<TiptapDom>(".bn-editor");
      const editor = dom?.editor?.schema.cached.blockNoteEditor;
      expect(editor).toBeDefined();
      return editor!;
    },
    { timeout: 5000 },
  );

/** The text of a stored tab's blocks, joined. */
export const storedText = (note: NoteDocument, tabId: string) =>
  JSON.stringify(note.blocksByTab[tabId] ?? []);

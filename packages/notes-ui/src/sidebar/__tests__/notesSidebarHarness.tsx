import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, expect, vi } from "vitest";

import type { LoamBridgeParams } from "@loam/shared/bridge/loamBridge";
import type { NoteFolder, NoteProject, NotesBootstrap } from "@loam/shared/notes/noteModel";

import { BridgeError } from "../../host/notesHost";
import { formatShortcut } from "../../keyboard/shortcuts";
import { installFakeBridge } from "../../testing/fakeBridge";
import { NotesWorkspaceProvider, useNotesWorkspace } from "../../workspace/NotesWorkspace";
import type { NoteDocument } from "../../workspace/types";

import { NotesSidebar } from "../NotesSidebar";
import type { NotesProjectScope } from "../notesTreeModel";
import { NotesTreeCommandsProvider } from "../useNotesTreeCommands";
import { NotesExtensionsProvider, type NotesExtensions } from "../../extensions/NotesExtensions";
import type { NotesHost } from "../../host/notesHost";

/** Shared fixtures and helpers for the notes sidebar tests. */

/**
 * jsdom has no layout. The tree is a virtual list sized from its scroll area's height, so
 * give elements a viewport-sized height for the tree to fill. Each test also starts with no
 * stored preferences (such as open folders). Call at the top of a file.
 */
export const stubTreeViewport = () => {
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get: () => 600,
    });
  });
  afterEach(() => localStorage.clear());
  afterAll(() => {
    if (offsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight);
  });
};

export const buildNote = ({
  id,
  title,
  folderId,
  projectId,
  position,
}: {
  id: string;
  title: string;
  folderId?: string;
  projectId?: string;
  position?: number;
}): NoteDocument => ({
  id,
  title,
  updatedAt: "2026-03-31T00:00:00.000Z",
  tabs: [{ id: `${id}-tab`, title: "Notes" }],
  blocksByTab: { [`${id}-tab`]: [] },
  activeTabId: `${id}-tab`,
  folderId,
  projectId,
  position,
});

export const folders: NoteFolder[] = [
  { id: "folder-planning", name: "Planning", position: 0 },
  { id: "folder-archive", name: "Archive", position: 1 },
];

export const notes: NoteDocument[] = [
  buildNote({ id: "root-later", title: "Root later", position: 1 }),
  buildNote({
    id: "folder-second",
    title: "Second plan",
    folderId: "folder-planning",
    position: 1,
  }),
  buildNote({ id: "root-first", title: "Root first", position: 0 }),
  buildNote({ id: "folder-first", title: "First plan", folderId: "folder-planning", position: 0 }),
];

/**
 * The library as the main process keeps it, answering the bridge the way the store does:
 * new notes go at the end of their folder (or project, or the top level), a layout numbers
 * each group's notes from 0, and deleted notes wait in Trash.
 */
const createLibraryStore = (
  initialNotes: readonly NoteDocument[],
  initialFolders: readonly NoteFolder[],
  initialProjects: readonly NoteProject[],
) => {
  const stored = new Map(initialNotes.map((note) => [note.id, structuredClone(note)]));
  let storedFolders = structuredClone([...initialFolders]);
  let storedProjects = structuredClone([...initialProjects]);
  const trash = new Map<string, NoteDocument>();
  let clock = Date.parse("2026-04-01T00:00:00.000Z");
  const read = (noteId: string) => {
    const note = stored.get(noteId);
    if (!note) throw new BridgeError("Note not found.", "NOT_FOUND");
    return note;
  };
  const full = (note: NoteDocument) => ({ ...structuredClone(note), contentState: "full" });
  const library = (): NotesBootstrap => ({
    projects: structuredClone(storedProjects),
    folders: structuredClone(storedFolders),
    notes: [...stored.values()].map((note) => ({
      ...structuredClone(note),
      contentState: "summary" as const,
    })) as NotesBootstrap["notes"],
  });
  /** A note's group: its folder, else its project, else the top level. */
  const groupOf = (note: { folderId?: string | null; projectId?: string | null }) =>
    note.folderId
      ? `folder:${note.folderId}`
      : note.projectId
        ? `project:${note.projectId}`
        : "top";
  const group = (folderId: string | null | undefined) =>
    [...stored.values()].filter((note) => (note.folderId ?? null) === (folderId ?? null));

  const answers = {
    "notes.library": library,
    "notes.get": ({ noteId }: LoamBridgeParams<"notes.get">) => full(read(noteId)),
    "notes.create": ({ note }: LoamBridgeParams<"notes.create">) => {
      const created = {
        ...structuredClone(note),
        folderId: note.folderId ?? undefined,
        projectId: (!note.folderId && note.projectId) || undefined,
        position: [...stored.values()].filter((entry) => groupOf(entry) === groupOf(note)).length,
        updatedAt: new Date((clock += 1000)).toISOString(),
      } as NoteDocument;
      stored.set(created.id, created);
      return full(created);
    },
    "notes.save": ({ noteId, patch }: LoamBridgeParams<"notes.save">) => {
      const note = read(noteId);
      const updatedAt = new Date((clock += 1000)).toISOString();
      stored.set(noteId, { ...note, ...(patch as Partial<NoteDocument>), updatedAt });
      return { updatedAt };
    },
    "notes.saveLayout": ({ layout }: LoamBridgeParams<"notes.saveLayout">) => {
      if (layout.projects)
        storedProjects = layout.projects.map((project, position) => ({ ...project, position }));
      storedFolders = layout.folders.map(({ id, name, projectId }, position) => ({
        id,
        name,
        position,
        ...(projectId ? { projectId } : {}),
      }));
      const folderIds = new Set(storedFolders.map((folder) => folder.id));
      const counts = new Map<string, number>();
      for (const { id, folderId, projectId } of layout.notes) {
        const note = stored.get(id);
        if (!note) continue;
        const place = {
          folderId: folderId ?? undefined,
          projectId: (!folderId && projectId) || undefined,
        };
        const position = counts.get(groupOf(place)) ?? 0;
        counts.set(groupOf(place), position + 1);
        stored.set(id, { ...note, ...place, position });
      }
      for (const note of stored.values())
        if (note.folderId && !folderIds.has(note.folderId))
          stored.set(note.id, { ...note, folderId: undefined });
      return library();
    },
    "notes.delete": ({ noteId }: LoamBridgeParams<"notes.delete">) => {
      const note = read(noteId);
      stored.delete(noteId);
      trash.set(noteId, note);
      return full(note);
    },
    "notes.restore": ({ note }: LoamBridgeParams<"notes.restore">) => {
      const restored = structuredClone(note) as NoteDocument;
      stored.set(note.id, restored);
      trash.delete(note.id);
      return full(restored);
    },
  };

  return {
    answers,
    /** The stored note, or undefined once it is deleted. */
    note: (noteId: string) => stored.get(noteId),
    noteIds: () => [...stored.keys()],
    inTrash: (noteId: string) => trash.has(noteId),
    /** Titles in a folder (null: the top level), in their stored order. */
    titlesIn: (folderId: string | null) =>
      group(folderId)
        .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
        .map((note) => note.title),
    /** Folder names in their stored order. */
    folderNames: () =>
      [...storedFolders]
        .sort((left, right) => left.position - right.position)
        .map((folder) => folder.name),
    /** Project names in their stored order. */
    projectNames: () =>
      [...storedProjects]
        .sort((left, right) => left.position - right.position)
        .map((project) => project.name),
    project: (name: string) => storedProjects.find((project) => project.name === name),
    folder: (name: string) => storedFolders.find((folder) => folder.name === name),
    /** Changes the library as sync or an AI client would, without the window knowing yet. */
    edit: (change: { notes?: NoteDocument[]; folders?: NoteFolder[] }) => {
      if (change.notes) {
        stored.clear();
        for (const note of change.notes) stored.set(note.id, structuredClone(note));
      }
      if (change.folders) storedFolders = structuredClone(change.folders);
    },
  };
};

export type LibraryStore = ReturnType<typeof createLibraryStore>;

export type SidebarOptions = {
  notes?: NoteDocument[];
  folders?: NoteFolder[];
  projects?: NoteProject[];
  /** The note open at the start; "root-first" unless given. */
  activeNoteId?: string | null;
  folderScopeId?: string | null;
  projectScope?: NotesProjectScope;
  extra?: ReactNode;
  /** What the app adds to the notes screens. */
  extensions?: NotesExtensions;
  /** What the host can do; everything by default. */
  capabilities?: NotesHost["capabilities"];
  /** Answers that replace the store's, for requests a test holds back or fails. */
  handlers?: (store: LibraryStore) => Parameters<typeof installFakeBridge>[0];
};

/**
 * Renders the sidebar over the real notes workspace, as the app does, with the bridge
 * answered by a library store. Resolves once the tree shows.
 */
export const renderSidebar = async (options: SidebarOptions = {}) => {
  const store = createLibraryStore(
    options.notes ?? notes,
    options.folders ?? folders,
    options.projects ?? [],
  );
  const { invoke, emit } = installFakeBridge(
    { ...store.answers, ...options.handlers?.(store) },
    { capabilities: options.capabilities },
  );
  const onOpenHistory = vi.fn();
  let workspace: ReturnType<typeof useNotesWorkspace> | null = null;
  function ReadWorkspace() {
    workspace = useNotesWorkspace();
    return null;
  }
  let folderScopeId = options.folderScopeId;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = () => (
    <QueryClientProvider client={queryClient}>
      <NotesExtensionsProvider value={options.extensions ?? {}}>
        <NotesWorkspaceProvider>
          <NotesTreeCommandsProvider>
            <ReadWorkspace />
            {options.extra}
            <NotesSidebar
              folderScopeId={folderScopeId}
              projectScope={options.projectScope}
              onOpenHistory={onOpenHistory}
            />
          </NotesTreeCommandsProvider>
        </NotesWorkspaceProvider>
      </NotesExtensionsProvider>
    </QueryClientProvider>
  );
  const view = render(element());
  await screen.findByRole("navigation", { name: "Notes" });
  const activeNoteId = options.activeNoteId === undefined ? "root-first" : options.activeNoteId;
  if (activeNoteId) act(() => workspace!.openNote(activeNoteId));
  return {
    ...view,
    store,
    invoke,
    onOpenHistory,
    /** The note open in the workspace. */
    activeNoteId: () => workspace!.activeNoteId,
    openNote: (noteId: string) => act(() => workspace!.openNote(noteId)),
    /** Shows one folder (an id), the top level (null) or everything (undefined). */
    showScope: (scope: string | null | undefined) => {
      folderScopeId = scope;
      view.rerender(element());
    },
    /** Changes the stored library elsewhere, and tells the window as sync does. */
    changeElsewhere: async (change: Parameters<LibraryStore["edit"]>[0]) => {
      const before = store.noteIds();
      store.edit(change);
      const after = new Set(store.noteIds());
      await act(async () =>
        emit("notes.changed", {
          changedNoteIds: [],
          deletedNoteIds: before.filter((noteId) => !after.has(noteId)),
          layoutChanged: true,
          conflicts: [],
        }),
      );
      await settle();
      await settle();
    },
  };
};

/** How many times the window sent `method`. */
export const callsTo = (invoke: { mock: { calls: unknown[][] } }, method: string) =>
  invoke.mock.calls.filter(([called]) => called === method);

/** A promise a test settles, for requests that should stay pending meanwhile. */
export const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

/** The shortcut hints that end the Undo and Redo items' names, right after their labels. */
export const UNDO = formatShortcut("edit.undo");
export const REDO = formatShortcut("edit.redo");

export const row = (name: string) => screen.getByRole("button", { name });
export const isSelected = (name: string) => row(name).getAttribute("aria-pressed") === "true";

export const openTreeMenu = (target: Element = screen.getByRole("navigation", { name: "Notes" })) =>
  fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });

export const clickMenuItem = async (name: string) => {
  const menuItem = await screen.findByRole("menuitem", { name });
  await act(async () => {
    fireEvent.click(menuItem);
  });
  await waitFor(() => expect(screen.queryByRole("menuitem", { name })).toBeNull());
  await settle();
};

/** A place in the open "Move to…" picker: a folder, or a project when `project` is set. */
export const movePlace = (name: string, { project = false } = {}) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return screen.findByRole("option", {
    name: new RegExp(`^${escaped}${project ? ", (Project|here now)" : "(, .*)?"}$`),
  });
};

/** Picks "Move to…" in the open menu, then `name` in the picker. */
export const moveTo = async (name: string, options: { project?: boolean } = {}) => {
  await clickMenuItem("Move to…");
  const place = await movePlace(name, options);
  await act(async () => {
    fireEvent.click(place);
  });
  await settle();
};

/**
 * Lets queued work finish: the menu runs its chosen action only after it closed, and
 * commands then wait on the bridge. One task turn covers both.
 */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

/** Types into the open name field and presses a key. */
export const typeName = async (label: string, value: string, key: "Enter" | "Escape" = "Enter") => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key });
  await settle();
};

const createDataTransfer = () => ({
  effectAllowed: "none",
  dropEffect: "none",
  setData: vi.fn(),
  getData: vi.fn(() => ""),
});

/** The strip under the top-level notes that takes drops to the top level. */
export const rootDropStrip = () =>
  document.querySelector<HTMLElement>("[data-native-sortable-zone]")!;

/** Starts dragging the row named `from` and holds it over `to` (below its middle, by default). */
export const hoverTreeRow = async (from: string, to: string | HTMLElement, clientY = 70) => {
  const source = row(from);
  const target = typeof to === "string" ? row(to) : to;
  const dataTransfer = createDataTransfer();
  Object.defineProperty(target, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      top: 40,
      height: 32,
      bottom: 72,
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: 40,
    }),
  });
  await act(async () => {
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer, clientY });
  });
  return {
    target,
    drop: () =>
      act(async () => {
        fireEvent.drop(target, { dataTransfer, clientY });
        fireEvent.dragEnd(source, { dataTransfer });
      }),
  };
};

export const dragTreeRow = async (from: string, to: string | HTMLElement, clientY = 70) => {
  const { drop } = await hoverTreeRow(from, to, clientY);
  await drop();
};

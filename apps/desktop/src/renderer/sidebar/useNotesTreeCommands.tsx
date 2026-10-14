import {
  createContext,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { NoteFolder, NoteProject } from "@loam/shared/notes/noteModel";

import { incrementDuplicateName } from "../lib/duplicateName";
import { toastMessage } from "../ui/toast";
import {
  useNotesWorkspace,
  type NewNotePlace,
  type NoteProjectDetails,
} from "../workspace/NotesWorkspace";
import type { NoteDocument } from "../workspace/types";

import {
  getNoteTitle,
  moveNotesToFolder,
  moveToProject,
  normalizeFolderName,
  normalizeNoteTitle,
  projectContents,
  returnToPlaces,
  type NotesDeleteCandidate,
  type NotesTreeItem,
} from "./notesTreeModel";

/** The one tree row being named in place: a new folder, or a note or folder being renamed. */
type NotesTreeEditing =
  | { kind: "new-folder"; projectId: string | null }
  | { kind: "note" | "folder"; id: string; name: string };

/** The project dialog: naming a new project, or changing one. */
export type NotesProjectDialogState = { mode: "create" } | { mode: "edit"; project: NoteProject };

type HistoryEntry = {
  /** What the step did, as in "Undo new note". */
  label: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
};

type History = { undo: HistoryEntry[]; redo: HistoryEntry[] };

const describeDeleted = (notes: number, folders: number) => {
  if (notes + folders > 1) return { label: "delete items", message: `${notes + folders} items` };
  return notes === 1
    ? { label: "delete note", message: "note" }
    : { label: "delete folder", message: "folder" };
};

const describeMoved = (notes: number, folders: number) => {
  if (folders === 0) return notes > 1 ? "move notes" : "move note";
  if (notes === 0) return folders > 1 ? "move folders" : "move folder";
  return "move items";
};

/**
 * Creating, renaming, moving, and deleting notes, folders, and projects from the tree, with
 * undo. The sidebar header buttons, the keyboard shortcut, and the Trash dialog use these
 * too, so they live above all of them in a context.
 */
function useNotesTreeCommandsState() {
  const library = useNotesWorkspace();
  const [editing, setEditing] = useState<NotesTreeEditing | null>(null);
  const [projectDialog, setProjectDialog] = useState<NotesProjectDialogState | null>(null);
  const [history, setHistory] = useState<History>({ undo: [], redo: [] });
  const [isRunningHistory, setIsRunningHistory] = useState(false);
  const [deleteRequest, setDeleteRequest] = useState<NotesDeleteCandidate | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const creatingNoteRef = useRef(false);

  // Work that finishes after the tree is gone (an Undo from a toast, a pending redo) does
  // nothing then. The latest library and history are read by such late work, too.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const latestRef = useRef({ library, history });
  useLayoutEffect(() => {
    latestRef.current = { library, history };
  });
  const isMounted = useCallback(() => mountedRef.current, []);
  const lib = useCallback(() => latestRef.current.library, []);
  const exists = (item: NotesTreeItem) =>
    item.kind === "note"
      ? lib().notes.some((note) => note.id === item.id)
      : lib().folders.some((folder) => folder.id === item.id);
  const findProject = (projectId: string) =>
    lib().projects.find((project) => project.id === projectId);

  const push = useCallback(
    (entry: HistoryEntry) =>
      setHistory((current) => ({ undo: [...current.undo, entry], redo: [] })),
    [],
  );

  const step = async (direction: "undo" | "redo", entry: HistoryEntry | undefined) => {
    if (!entry || isRunningHistory) return;
    setIsRunningHistory(true);
    try {
      await entry[direction]();
      if (!isMounted()) return;
      setHistory((current) =>
        direction === "undo"
          ? { undo: current.undo.filter((e) => e !== entry), redo: [...current.redo, entry] }
          : { undo: [...current.undo, entry], redo: current.redo.filter((e) => e !== entry) },
      );
    } finally {
      if (isMounted()) setIsRunningHistory(false);
    }
  };

  /** Shows what a step did, with an Undo that works while it is still the latest step. */
  const announce = (entry: HistoryEntry, message: string, description?: string) =>
    toastMessage(message, {
      id: "notes-tree-step",
      description,
      duration: 8000,
      action: {
        label: "Undo",
        // Only while the step is still the latest, and the tree is still there.
        onClick: () => {
          if (isMounted() && latestRef.current.history.undo.at(-1) === entry) {
            void step("undo", entry);
          }
        },
      },
    });

  /** Records a note just made as a step: Undo moves it to Trash, Redo brings it back. */
  const pushCreatedNote = useCallback(
    (label: string, created: NoteDocument) => {
      let snapshot = created;
      // Undo returns at once, so Redo is offered while the delete settles; Redo waits.
      let pendingDelete: Promise<unknown> = Promise.resolve();
      push({
        label,
        undo: () => {
          pendingDelete = lib()
            .deleteNote(created.id)
            .then((deleted) => {
              snapshot = deleted ?? snapshot;
            });
        },
        redo: async () => {
          await pendingDelete;
          if (isMounted()) await lib().restoreNote(snapshot);
        },
      });
    },
    [isMounted, lib, push],
  );

  // Stable, so the app's keyboard shortcut does not re-register on every change.
  const createNote = useCallback(
    async (place?: NewNotePlace) => {
      if (creatingNoteRef.current) return;
      creatingNoteRef.current = true;
      try {
        const created = await lib().createNote(place);
        if (created) pushCreatedNote("new note", created);
      } finally {
        creatingNoteRef.current = false;
      }
    },
    [lib, pushCreatedNote],
  );

  const duplicateNote = async (note: NoteDocument) => {
    const created = await lib().duplicateNote(note.id, incrementDuplicateName(getNoteTitle(note)));
    if (created) pushCreatedNote("duplicate note", created);
  };

  const commitEdit = async (text: string) => {
    if (!editing) return;
    setEditing(null);
    try {
      if (editing.kind === "new-folder") {
        const name = normalizeFolderName(text);
        const created = name
          ? await lib().createFolder(name, editing.projectId ?? undefined)
          : null;
        if (!created) return;
        let snapshot = created;
        push({
          label: "new folder",
          undo: async () => {
            snapshot = (await lib().deleteFolder(created.id)) ?? snapshot;
          },
          redo: () => lib().restoreFolder(snapshot),
        });
        return;
      }
      const { kind, id, name: previous } = editing;
      const name = kind === "note" ? normalizeNoteTitle(text) : normalizeFolderName(text);
      // A folder always has a name; clearing it keeps the current one.
      if (name === previous || (kind === "folder" && !name)) return;
      const rename = (value: string) => {
        if (!exists({ kind, id })) return;
        return kind === "note" ? lib().renameNote(id, value) : lib().renameFolder(id, value);
      };
      await rename(name);
      push({
        label: `rename ${kind}`,
        undo: () => rename(previous),
        redo: () => rename(name),
      });
    } catch {
      // The library restores the previous state and reports the error; nothing to undo.
    }
  };

  /**
   * Puts notes and folders back where they were before a step, as one save; a project the
   * step removed comes back first, at its earlier place.
   */
  const returnItems = async (
    before: { notes: NoteDocument[]; folders: NoteFolder[] },
    items: { noteIds: readonly string[]; folderIds?: readonly string[] },
    project?: NoteProject,
  ) => {
    const { notes, folders, projects } = lib();
    const nextProjects = [...projects].sort((left, right) => left.position - right.position);
    if (project && !nextProjects.some((entry) => entry.id === project.id))
      nextProjects.splice(Math.min(project.position, nextProjects.length), 0, project);
    const returned = returnToPlaces({
      notes,
      folders,
      projects: nextProjects,
      before,
      ...items,
    });
    await lib().rearrange(
      {
        projects: nextProjects.map((entry, position) => ({ ...entry, position })),
        ...returned,
      },
      project ? "Project not restored" : "Not moved back",
    );
  };

  /** Moves notes to the end of a folder, or out of their folders (null), as one step. */
  const moveNotes = async (noteIds: readonly string[], folderId: string | null) => {
    const before = { notes: lib().notes, folders: lib().folders };
    const move = async () => {
      const moved = moveNotesToFolder({ ...lib(), noteIds, folderId });
      if (moved) await lib().rearrange({ notes: moved }, "Note not moved");
      return Boolean(moved);
    };
    if (!(await move())) return;
    push({
      label: describeMoved(noteIds.length, 0),
      undo: () => returnItems(before, { noteIds }),
      redo: async () => void (await move()),
    });
  };

  /** Moves notes and folders into a project, or out of every project (null), as one step. */
  const moveItemsToProject = async (
    items: { noteIds: readonly string[]; folderIds: readonly string[] },
    projectId: string | null,
  ) => {
    const before = { notes: lib().notes, folders: lib().folders };
    const move = async () => {
      const moved = moveToProject({ ...lib(), ...items, projectId });
      if (moved) await lib().rearrange(moved, "Not moved");
      return Boolean(moved);
    };
    if (!(await move())) return;
    push({
      label: describeMoved(items.noteIds.length, items.folderIds.length),
      undo: () => returnItems(before, items),
      redo: async () => void (await move()),
    });
  };

  /** Removes a project; what it holds moves to the end of the top level. Returns its snapshot. */
  const dropProject = async (projectId: string) => {
    const project = findProject(projectId);
    if (!project) return null;
    const before = { notes: lib().notes, folders: lib().folders };
    const contents = projectContents({ ...lib(), projectId });
    const moved = moveToProject({ ...lib(), ...contents, projectId: null });
    await lib().rearrange(
      {
        projects: lib()
          .projects.filter((entry) => entry.id !== projectId)
          .map((entry, position) => ({ ...entry, position })),
        ...moved,
      },
      "Project not removed",
    );
    return { project, before, contents };
  };

  const removeProject = async (projectId: string) => {
    let removed = await dropProject(projectId);
    if (!removed) return;
    const entry: HistoryEntry = {
      label: "remove project",
      undo: () => {
        if (removed) return returnItems(removed.before, removed.contents, removed.project);
      },
      redo: async () => {
        removed = (await dropProject(projectId)) ?? removed;
      },
    };
    push(entry);
    announce(
      entry,
      `Removed project “${removed.project.name}”.`,
      removed.contents.noteIds.length + removed.contents.folderIds.length > 0
        ? "What it held is at the top level now."
        : undefined,
    );
  };

  const submitProjectDialog = async (details: NoteProjectDetails) => {
    const dialog = projectDialog;
    setProjectDialog(null);
    if (!dialog) return;
    if (dialog.mode === "create") {
      const created = await lib().createProject(details);
      if (!created) return;
      let removed: Awaited<ReturnType<typeof dropProject>> = null;
      push({
        label: "new project",
        undo: async () => {
          removed = (await dropProject(created.id)) ?? removed;
        },
        redo: () => {
          if (removed) return returnItems(removed.before, removed.contents, removed.project);
        },
      });
      return;
    }
    const { id, name, icon } = dialog.project;
    if (name === details.name && JSON.stringify(icon) === JSON.stringify(details.icon)) return;
    const update = (value: NoteProjectDetails) => {
      if (findProject(id)) return lib().updateProject(id, value);
    };
    await update(details);
    push({
      label: "edit project",
      undo: () => update({ name, icon }),
      redo: () => update(details),
    });
  };

  const deleteItems = async (candidate: NotesDeleteCandidate) => {
    if (candidate.noteIds.length === 1 && candidate.folderIds.length === 0) {
      const deleted = await lib().deleteNote(candidate.noteIds[0]!);
      return { notes: deleted ? [deleted] : [], folders: [] };
    }
    return lib().deleteSelection(candidate);
  };

  const confirmDelete = async () => {
    const candidate = deleteRequest;
    if (!candidate || isDeleting) return;
    setIsDeleting(true);
    // Read before the delete, which moves the workspace off a deleted open note.
    const activeNoteId = lib().activeNoteId;
    try {
      const deleted = await deleteItems(candidate);
      if (!isMounted()) return;
      setDeleteRequest(null);
      if (deleted.notes.length + deleted.folders.length === 0) return;

      let snapshots = deleted;
      const { label, message } = describeDeleted(deleted.notes.length, deleted.folders.length);
      const entry: HistoryEntry = {
        label,
        undo: async () => {
          await Promise.all(snapshots.folders.map((folder) => lib().restoreFolder(folder)));
          await Promise.all(
            snapshots.notes.map((note) =>
              lib().restoreNote(note, { focus: note.id === activeNoteId }),
            ),
          );
        },
        redo: async () => {
          const again = await deleteItems({
            noteIds: snapshots.notes.map((note) => note.id),
            folderIds: snapshots.folders.map((folder) => folder.id),
          });
          snapshots = {
            notes: again.notes.length > 0 ? again.notes : snapshots.notes,
            folders: again.folders.length > 0 ? again.folders : snapshots.folders,
          };
        },
      };
      push(entry);
      announce(entry, `Deleted ${message}.`);
    } finally {
      if (isMounted()) setIsDeleting(false);
    }
  };

  const startFolderCreation = useCallback(
    (projectId: string | null = null) => setEditing({ kind: "new-folder", projectId }),
    [],
  );
  const forgetHistory = useCallback(() => setHistory({ undo: [], redo: [] }), []);
  const lastUndo = history.undo.at(-1);
  const lastRedo = history.redo.at(-1);
  return {
    editing,
    startFolderCreation,
    startRename: (item: NotesTreeItem, name: string) => setEditing({ ...item, name }),
    cancelEdit: () => setEditing(null),
    commitEdit,
    createNote,
    duplicateNote,
    moveNotes,
    moveItemsToProject,
    projectDialog,
    startProjectCreation: () => setProjectDialog({ mode: "create" }),
    startProjectEdit: (project: NoteProject) => setProjectDialog({ mode: "edit", project }),
    closeProjectDialog: () => setProjectDialog(null),
    submitProjectDialog,
    removeProject,
    deleteRequest,
    isDeleting,
    requestDelete: setDeleteRequest,
    confirmDelete,
    undoLabel: lastUndo ? `Undo ${lastUndo.label}` : "Undo",
    redoLabel: lastRedo ? `Redo ${lastRedo.label}` : "Redo",
    canUndo: Boolean(lastUndo) && !isRunningHistory,
    canRedo: Boolean(lastRedo) && !isRunningHistory,
    undo: () => step("undo", lastUndo),
    redo: () => step("redo", lastRedo),
    /** Permanently deleting from Trash makes earlier steps impossible to undo. */
    forgetHistory,
  };
}

export type NotesTreeCommands = ReturnType<typeof useNotesTreeCommandsState>;

const NotesTreeCommandsContext = createContext<NotesTreeCommands | null>(null);

/** The tree commands over the notes workspace, for the sidebar and the app around it. */
export function NotesTreeCommandsProvider({ children }: { children: ReactNode }) {
  const commands = useNotesTreeCommandsState();
  return <NotesTreeCommandsContext value={commands}>{children}</NotesTreeCommandsContext>;
}

export const useNotesTreeCommands = () => {
  const commands = use(NotesTreeCommandsContext);
  if (!commands) throw new Error("useNotesTreeCommands needs a NotesTreeCommandsProvider.");
  return commands;
};

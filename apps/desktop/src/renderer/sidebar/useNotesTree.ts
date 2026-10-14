import { useReducedMotion } from "framer-motion";
import { useMemo, useState } from "react";

import type { NoteFolder, NoteProject } from "@loam/shared/notes/noteModel";

import { readPreference, writePreference } from "../lib/preferences";
import { sortByPosition } from "../lib/sortByPosition";
import type { NoteDocument } from "../workspace/types";

import {
  buildNotesTreeRows,
  notesHaveSameTreeShape,
  serializeIds,
  type NotesProjectScope,
} from "./notesTreeModel";

const NO_IDS: ReadonlySet<string> = new Set();

/**
 * The keys of rows that appeared since the last change (a new note, an opened folder),
 * so they can fade in once. Rows of the first render, and users who prefer reduced
 * motion, get none.
 */
function useEnteringKeys(keys: readonly string[]) {
  const reduceMotion = useReducedMotion() ?? false;
  const [state, setState] = useState({ keys, entering: NO_IDS });
  if (state.keys !== keys) {
    const previous = new Set(state.keys);
    setState({
      keys,
      entering: reduceMotion ? NO_IDS : new Set(keys.filter((key) => !previous.has(key))),
    });
  }
  return state.entering;
}

/**
 * The sidebar folders left open, and the projects closed (projects start open): preferences
 * of this computer, not part of the notes.
 */
const OPEN_FOLDER_IDS_KEY = "notes.sidebar.open-folder-ids";
const CLOSED_PROJECT_IDS_KEY = "notes.sidebar.closed-project-ids";

const readIds = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : null;

/**
 * Which folders are open: the stored ones, plus the active note's folder and the folder the
 * sidebar is scoped to, each opened when it changes (and then free to close).
 */
function useOpenFolders({
  activeFolderId,
  scopeFolderId,
}: {
  activeFolderId: string | null;
  scopeFolderId: string | null;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => {
    const stored = new Set(readPreference(OPEN_FOLDER_IDS_KEY, readIds));
    for (const id of [activeFolderId, scopeFolderId]) if (id) stored.add(id);
    return stored;
  });
  const [seen, setSeen] = useState({ activeFolderId, scopeFolderId });
  if (seen.activeFolderId !== activeFolderId || seen.scopeFolderId !== scopeFolderId) {
    setSeen({ activeFolderId, scopeFolderId });
    const next = new Set(open);
    if (activeFolderId && seen.activeFolderId !== activeFolderId) next.add(activeFolderId);
    if (scopeFolderId && seen.scopeFolderId !== scopeFolderId) next.add(scopeFolderId);
    setOpen(next);
  }
  return [open, setOpen] as const;
}

/**
 * Which projects are closed: the stored ones, less the active note's project, which opens
 * when it changes (and is then free to close).
 */
function useClosedProjects(activeProjectId: string | null) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => {
    const stored = new Set(readPreference(CLOSED_PROJECT_IDS_KEY, readIds));
    if (activeProjectId) stored.delete(activeProjectId);
    return stored;
  });
  const [seen, setSeen] = useState(activeProjectId);
  if (seen !== activeProjectId) {
    setSeen(activeProjectId);
    if (activeProjectId && closed.has(activeProjectId)) {
      const next = new Set(closed);
      next.delete(activeProjectId);
      setClosed(next);
    }
  }
  return [closed, setClosed] as const;
}

/** The notes tree for a scope: its rows, open folders and projects, and lookups by id. */
export function useNotesTree({
  notes,
  folders,
  projects,
  activeNoteId,
  folderScopeId,
  projectScope,
  creatingFolderIn,
}: {
  notes: NoteDocument[];
  folders: NoteFolder[];
  projects: NoteProject[];
  activeNoteId: string | null;
  /** Undefined defers to the project scope; null shows top-level notes; an id one folder. */
  folderScopeId: string | null | undefined;
  /** The projects shown (null: what is outside projects); undefined shows all of them. */
  projectScope: NotesProjectScope | undefined;
  /** The project a new folder is being named in, null at the top level, undefined for none. */
  creatingFolderIn: string | null | undefined;
}) {
  const sortedFolders = useMemo(() => sortByPosition(folders), [folders]);
  const sortedProjects = useMemo(() => sortByPosition(projects), [projects]);
  const sortedNotes = useMemo(() => sortByPosition(notes), [notes]);
  const notesById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  const foldersById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const activeNote = notesById.get(activeNoteId ?? "");
  const activeFolder = foldersById.get(activeNote?.folderId ?? "");
  const activeProjectId = (activeFolder ? activeFolder.projectId : activeNote?.projectId) ?? null;
  const [openFolders, setOpenFolders] = useOpenFolders({
    activeFolderId: activeFolder?.id ?? null,
    scopeFolderId: typeof folderScopeId === "string" ? folderScopeId : null,
  });
  const [closedProjects, setClosedProjects] = useClosedProjects(
    activeProjectId && projectsById.has(activeProjectId) ? activeProjectId : null,
  );

  // A tab switch or body edit replaces note objects without changing the tree; keeping
  // the previous list then keeps the rows (and the virtual list) as they are.
  const [treeNotes, setTreeNotes] = useState(sortedNotes);
  if (treeNotes !== sortedNotes && !notesHaveSameTreeShape(treeNotes, sortedNotes)) {
    setTreeNotes(sortedNotes);
  }

  const tree = useMemo(
    () =>
      buildNotesTreeRows({
        notes: treeNotes,
        folders: sortedFolders,
        projects: sortedProjects,
        folderScopeId,
        projectScope,
        openFolderIds: openFolders,
        closedProjectIds: closedProjects,
        creatingFolderIn,
      }),
    [
      closedProjects,
      creatingFolderIn,
      folderScopeId,
      openFolders,
      projectScope,
      sortedFolders,
      sortedProjects,
      treeNotes,
    ],
  );
  const rowKeys = useMemo(() => tree.rows.map((row) => row.key), [tree.rows]);
  const enteringKeys = useEnteringKeys(rowKeys);

  const setFolderOpen = (folderId: string, isOpen: boolean) => {
    if (openFolders.has(folderId) === isOpen) return;
    const next = new Set(openFolders);
    if (isOpen) next.add(folderId);
    else next.delete(folderId);
    setOpenFolders(next);
    writePreference(OPEN_FOLDER_IDS_KEY, serializeIds(next, sortedFolders));
  };
  const setProjectOpen = (projectId: string, isOpen: boolean) => {
    if (closedProjects.has(projectId) !== isOpen) return;
    const next = new Set(closedProjects);
    if (isOpen) next.delete(projectId);
    else next.add(projectId);
    setClosedProjects(next);
    writePreference(CLOSED_PROJECT_IDS_KEY, serializeIds(next, sortedProjects));
  };

  return {
    ...tree,
    sortedNotes,
    sortedFolders,
    sortedProjects,
    notesById,
    foldersById,
    projectsById,
    enteringKeys,
    openFolder: (folderId: string) => setFolderOpen(folderId, true),
    toggleFolder: (folderId: string) => setFolderOpen(folderId, !openFolders.has(folderId)),
    openProject: (projectId: string) => setProjectOpen(projectId, true),
    toggleProject: (projectId: string) => setProjectOpen(projectId, closedProjects.has(projectId)),
  };
}

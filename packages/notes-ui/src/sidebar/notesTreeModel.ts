import type { NoteFolder, NoteProject } from "@loam/shared/notes/noteModel";
import { isInsideNote, resolveNoteParents } from "@loam/shared/notes/noteParents";

import { applySortableItemMove } from "../lib/moveItemBefore";
import { sortByPosition } from "../lib/sortByPosition";
import type { NoteDocument } from "../workspace/types";

/**
 * The notes tree as data: projects at the top, each holding folders and notes, then the
 * folders and notes outside every project. Folders hold notes, one level deep, and any note
 * can hold sub-notes, as deep as they go. Everything here is pure; the sidebar's hooks call
 * these to group, list, select, and move.
 */

export const MAX_FOLDER_NAME_LENGTH = 48;
export const MAX_NOTE_TITLE_LENGTH = 120;

export const getNoteTitle = (note: Pick<NoteDocument, "title">) =>
  note.title.trim() || "Untitled note";
export const normalizeFolderName = (value: string) => value.trim().slice(0, MAX_FOLDER_NAME_LENGTH);
export const normalizeNoteTitle = (value: string) => value.trim().slice(0, MAX_NOTE_TITLE_LENGTH);

// Selection keys name a tree item in the selection set and in the action menu. A project is
// never part of a selection; its key only tells the menu which project was right-clicked.

export type NotesTreeItem = { kind: "note" | "folder"; id: string };

export const noteSelectionKey = (noteId: string) => `note:${noteId}`;
export const isNoteSelectionKey = (key: string) => key.startsWith("note:");
export const folderSelectionKey = (folderId: string) => `folder:${folderId}`;
export const projectSelectionKey = (projectId: string) => `project:${projectId}`;
export const treeSelectionKey = (item: NotesTreeItem) =>
  item.kind === "note" ? noteSelectionKey(item.id) : folderSelectionKey(item.id);

type TreeEntry = NotesTreeItem | { kind: "project"; id: string };

const parseKey = (key: string, prefix: string): TreeEntry | null => {
  if (!key.startsWith(prefix)) return null;
  const [kind, ...id] = key.slice(prefix.length).split(":");
  return kind === "note" || kind === "folder" || kind === "project"
    ? { kind, id: id.join(":") }
    : null;
};

export const treeItemFromSelectionKey = (key: string): NotesTreeItem | null => {
  const entry = parseKey(key, "");
  return entry?.kind === "project" ? null : entry;
};
export const projectIdFromSelectionKey = (key: string) => {
  const entry = parseKey(key, "");
  return entry?.kind === "project" ? entry.id : null;
};

export type NotesDeleteCandidate = { noteIds: string[]; folderIds: string[] };

/** The existing notes and folders a set of selection keys names, or null for none. */
export const deleteCandidateFromKeys = (
  keys: Iterable<string>,
  exists: (item: NotesTreeItem) => boolean,
): NotesDeleteCandidate | null => {
  const candidate: NotesDeleteCandidate = { noteIds: [], folderIds: [] };
  for (const key of keys) {
    const item = treeItemFromSelectionKey(key);
    if (!item || !exists(item)) continue;
    (item.kind === "note" ? candidate.noteIds : candidate.folderIds).push(item.id);
  }
  return candidate.noteIds.length + candidate.folderIds.length > 0 ? candidate : null;
};

// Drag ids name what is dragged or dropped on in the native drag-and-drop list.

const DRAG_PREFIX = "notes-tree:";
export const NOTES_TREE_ROOT_DROP_ID = "notes-tree-root";
/** The strip between the projects and the top-level notes; a note dropped there goes first. */
export const NOTES_TREE_START_DROP_ID = "notes-tree-start";
/** The empty space under the list; a drop there also goes to the top level. */
export const NOTES_TREE_END_DROP_ID = "notes-tree-end";
const isTopLevelDropId = (id: string) =>
  id === NOTES_TREE_ROOT_DROP_ID ||
  id === NOTES_TREE_START_DROP_ID ||
  id === NOTES_TREE_END_DROP_ID;

export const noteDragId = (noteId: string) => `${DRAG_PREFIX}note:${noteId}`;
export const folderDragId = (folderId: string) => `${DRAG_PREFIX}folder:${folderId}`;
export const projectDragId = (projectId: string) => `${DRAG_PREFIX}project:${projectId}`;
const parseDragId = (id: string) => parseKey(id, DRAG_PREFIX);
/** The folder or project a drag id names, which opens when a note is dropped on it. */
export const containerFromDragId = (id: string) => {
  const entry = parseDragId(id);
  return entry?.kind === "folder" || entry?.kind === "project" ? entry : null;
};
/**
 * Whether a drop on `targetId` puts `sourceId` inside it, whichever half it lands on: a note
 * onto a folder or project, or a folder onto a project. A project among projects, or a folder
 * among folders, moves beside it instead.
 */
export const dropsInsideNotesTreeTarget = (sourceId: string, targetId: string) => {
  const container = containerFromDragId(targetId);
  return container !== null && parseDragId(sourceId)?.kind !== container.kind;
};

// Places: where each note and folder sits.

type TreeNote = Pick<NoteDocument, "id" | "folderId" | "projectId" | "parentNoteId" | "position">;
type TreeFolder = Pick<NoteFolder, "id" | "projectId" | "position">;
type TreeProject = Pick<NoteProject, "id" | "position">;

/** A group of notes: the top level's own, a project's own, a folder's, or a note's sub-notes. */
type NoteGroup = string;
const TOP_GROUP: NoteGroup = "top";
const projectGroup = (projectId: string): NoteGroup => `project:${projectId}`;
const folderGroup = (folderId: string): NoteGroup => `folder:${folderId}`;
const subNoteGroup = (noteId: string): NoteGroup => `note:${noteId}`;

const groupId = (group: NoteGroup, kind: "folder" | "project" | "note") =>
  group.startsWith(`${kind}:`) ? group.slice(kind.length + 1) : undefined;

/**
 * The place a group gives its notes: a folder decides the project of the notes in it, and a
 * sub-note is wherever its parent is.
 */
const placeIn = <TNote extends TreeNote>(note: TNote, group: NoteGroup, position: number) => ({
  ...note,
  folderId: groupId(group, "folder"),
  projectId: groupId(group, "project"),
  parentNoteId: groupId(group, "note"),
  position,
});

/**
 * Reads places against the folders, projects and notes that exist: anything placed in one
 * that is gone counts as being at the top level.
 */
const placesOf = <TFolder extends TreeFolder, TProject extends TreeProject>(
  folders: readonly TFolder[],
  projects: readonly TProject[],
  notes: readonly TreeNote[],
) => {
  const sortedFolders = sortByPosition(folders);
  const sortedProjects = sortByPosition(projects);
  const folderIds = new Set(sortedFolders.map((folder) => folder.id));
  const projectIds = new Set(sortedProjects.map((project) => project.id));
  const projectOf = (projectId: string | null | undefined) =>
    projectId && projectIds.has(projectId) ? projectId : null;
  const foldersById = new Map(sortedFolders.map((folder) => [folder.id, folder]));
  const notesById = new Map(notes.map((note) => [note.id, note]));
  const parents = resolveNoteParents(
    notes.map((note) =>
      note.folderId && folderIds.has(note.folderId) ? note : { ...note, folderId: undefined },
    ),
  );
  /** The note a sub-note is inside, at any depth; the note itself otherwise. */
  const outermost = (note: TreeNote) => {
    let current = note;
    for (let parentId = parents.get(note.id); parentId; parentId = parents.get(current.id))
      current = notesById.get(parentId) ?? current;
    return current;
  };
  return {
    sortedFolders,
    sortedProjects,
    folderIds,
    projectIds,
    projectOf,
    parents,
    /** The group a note is in. */
    groupOf: (note: TreeNote): NoteGroup => {
      if (note.folderId && folderIds.has(note.folderId)) return folderGroup(note.folderId);
      const parentId = parents.get(note.id);
      if (parentId) return subNoteGroup(parentId);
      const projectId = projectOf(note.projectId);
      return projectId ? projectGroup(projectId) : TOP_GROUP;
    },
    /** The folder a note is in, through the notes it is inside; null outside folders. */
    noteFolder: (note: TreeNote) => {
      const { folderId } = outermost(note);
      return folderId && folderIds.has(folderId) ? folderId : null;
    },
    /** The project a note is in, through its folder, the notes it is inside, or on its own. */
    noteProject: (note: TreeNote) => {
      const root = outermost(note);
      const folder = root.folderId ? foldersById.get(root.folderId) : undefined;
      return projectOf(folder ? folder.projectId : root.projectId);
    },
    /** Every group, in the order the layout lists notes: top level, projects, folders, notes. */
    groupOrder: [
      TOP_GROUP,
      ...sortedProjects.map((project) => projectGroup(project.id)),
      ...sortedFolders.map((folder) => folderGroup(folder.id)),
      ...notes.map((note) => subNoteGroup(note.id)),
    ],
  };
};

/** The notes a note is inside, nearest first. */
export const noteAncestorIds = (
  notes: readonly TreeNote[],
  folders: readonly TreeFolder[],
  noteId: string,
) => {
  const { parents } = placesOf(folders, [], notes);
  const ancestors: string[] = [];
  for (let parentId = parents.get(noteId); parentId; parentId = parents.get(parentId))
    ancestors.push(parentId);
  return ancestors;
};

/** The folder and project a note shows in, through the notes it is inside. */
export const notePlaceOf = (
  tree: Tree<TreeNote, TreeFolder, TreeProject>,
  note: TreeNote | undefined,
) => {
  if (!note) return { folderId: null, projectId: null };
  const places = placesOf(tree.folders, tree.projects, tree.notes);
  return { folderId: places.noteFolder(note), projectId: places.noteProject(note) };
};

/** What grouping notes needs from their places. */
type Places = Pick<ReturnType<typeof placesOf>, "groupOf" | "groupOrder">;

/** Notes by group, each group in order. */
const groupNotes = <TNote extends TreeNote>(notes: readonly TNote[], places: Places) => {
  const groups = new Map<NoteGroup, TNote[]>(places.groupOrder.map((group) => [group, []]));
  for (const note of sortByPosition(notes)) groups.get(places.groupOf(note))!.push(note);
  return groups;
};

/** Notes in layout order, each placed by its group, with positions renumbered per group. */
const flattenGroups = <TNote extends TreeNote>(
  groups: ReadonlyMap<NoteGroup, TNote[]>,
  places: Places,
) =>
  places.groupOrder.flatMap((group) =>
    (groups.get(group) ?? []).map((note, position) => placeIn(note, group, position)),
  );

/** Folders in order, with positions renumbered. */
const numbered = <TItem extends { position: number }>(items: readonly TItem[]) =>
  items.map((item, position) => ({ ...item, position }));

// The rendered rows.

/**
 * The flat list of rows the sidebar renders: each project followed by its notes and folders
 * while it is open, then the top-level notes (under a strip that takes notes to the top of
 * them, when projects show above), the strip that takes drops to the top level,
 * and each folder followed by its notes while it is open. Every row has a fixed height, so
 * the virtual list and the drag rectangle place rows without measuring them.
 */
export type NotesTreeRow =
  | {
      kind: "project";
      key: string;
      id: string;
      project: NoteProject;
      isOpen: boolean;
      isEmpty: boolean;
      /** The last row shown inside the open project, where a drop "after" it is drawn. */
      lastChildKey: string | null;
    }
  | {
      kind: "folder";
      key: string;
      id: string;
      folder: NoteFolder;
      depth: 0 | 1;
      isOpen: boolean;
      /** The last note shown inside the open folder, where a drop "after" it is drawn. */
      lastChildKey: string | null;
    }
  | {
      kind: "note";
      key: string;
      id: string;
      note: NoteDocument;
      depth: number;
      /** Whether the note holds sub-notes, and whether they show. */
      hasSubNotes: boolean;
      isOpen: boolean;
      /** The last row shown inside the open note, where a drop "after" it is drawn. */
      lastChildKey: string | null;
    }
  | {
      kind: "root-drop";
      key: string;
      /** The drop id: the top of the top-level notes, or after them. */
      dropId: typeof NOTES_TREE_START_DROP_ID | typeof NOTES_TREE_ROOT_DROP_ID;
    }
  | { kind: "creating-folder"; key: string; depth: 0 | 1 };

const rootDropRow: NotesTreeRow = {
  kind: "root-drop",
  key: "root-drop",
  dropId: NOTES_TREE_ROOT_DROP_ID,
};

export const notesTreeRowHeight = (row: NotesTreeRow) => (row.kind === "root-drop" ? 16 : 34);

/** Which projects the tree shows; null stands for everything outside projects. */
export type NotesProjectScope = ReadonlySet<string | null>;

/** The one project shown, where new notes and folders go; undefined unless just one is. */
export const scopedProjectOf = (scope: NotesProjectScope | undefined) => {
  const [only] = scope?.size === 1 ? [...scope] : [];
  return only ?? undefined;
};

/**
 * Builds the rows for a scope. A folder scope shows one folder (a string), or only the notes
 * outside folders and projects (null); otherwise the project scope picks the projects shown,
 * or all of them when undefined. Also returns the selection keys of the visible rows in order
 * (for range selection), and of every item in scope, shown or inside something closed.
 */
export const buildNotesTreeRows = ({
  notes,
  folders,
  projects,
  folderScopeId,
  projectScope,
  openFolderIds,
  openNoteIds,
  closedProjectIds,
  creatingFolderIn,
}: {
  notes: readonly NoteDocument[];
  folders: readonly NoteFolder[];
  projects: readonly NoteProject[];
  folderScopeId: string | null | undefined;
  projectScope: NotesProjectScope | undefined;
  openFolderIds: ReadonlySet<string>;
  /** Notes whose sub-notes show. */
  openNoteIds: ReadonlySet<string>;
  closedProjectIds: ReadonlySet<string>;
  /** The project a new folder is being named in, null at the top level, undefined for none. */
  creatingFolderIn: string | null | undefined;
}) => {
  const places = placesOf(folders, projects, notes);
  const groups = groupNotes(notes, places);
  const foldersOf = (projectId: string | null) =>
    places.sortedFolders.filter((folder) => places.projectOf(folder.projectId) === projectId);

  const rows: NotesTreeRow[] = [];
  const keys: string[] = [];
  const scopeKeys = new Set<string>();
  const addNote = (note: NoteDocument, depth: number, shown: boolean) => {
    const key = noteSelectionKey(note.id);
    const subNotes = groups.get(subNoteGroup(note.id)) ?? [];
    const isOpen = subNotes.length > 0 && openNoteIds.has(note.id);
    scopeKeys.add(key);
    const row: Extract<NotesTreeRow, { kind: "note" }> = {
      kind: "note",
      key,
      id: note.id,
      note,
      depth,
      hasSubNotes: subNotes.length > 0,
      isOpen,
      lastChildKey: null,
    };
    if (shown) {
      rows.push(row);
      keys.push(key);
    }
    const first = rows.length;
    for (const subNote of subNotes) addNote(subNote, depth + 1, shown && isOpen);
    row.lastChildKey = shown && rows.length > first ? rows.at(-1)!.key : null;
  };
  const addFolder = (folder: NoteFolder, depth: 0 | 1, shown: boolean) => {
    const key = folderSelectionKey(folder.id);
    const children = groups.get(folderGroup(folder.id)) ?? [];
    const isOpen = openFolderIds.has(folder.id);
    scopeKeys.add(key);
    const row: Extract<NotesTreeRow, { kind: "folder" }> = {
      kind: "folder",
      key,
      id: folder.id,
      folder,
      depth,
      isOpen,
      lastChildKey: null,
    };
    if (shown) {
      rows.push(row);
      keys.push(key);
    }
    const first = rows.length;
    for (const note of children) addNote(note, depth + 1, shown && isOpen);
    row.lastChildKey = shown && rows.length > first ? rows.at(-1)!.key : null;
  };
  const addCreatingFolder = (projectId: string | null, depth: 0 | 1) => {
    if (creatingFolderIn === projectId)
      rows.push({ kind: "creating-folder", key: "creating-folder", depth });
  };

  if (typeof folderScopeId === "string") {
    rows.push(rootDropRow);
    const folder = places.sortedFolders.find((entry) => entry.id === folderScopeId);
    if (folder) addFolder(folder, 0, true);
    addCreatingFolder(null, 0);
    return { rows, keys, scopeKeys };
  }
  if (folderScopeId === null) {
    for (const note of groups.get(TOP_GROUP)!) addNote(note, 0, true);
    rows.push(rootDropRow);
    addCreatingFolder(null, 0);
    return { rows, keys, scopeKeys };
  }

  for (const project of places.sortedProjects) {
    if (projectScope && !projectScope.has(project.id)) continue;
    const ownNotes = groups.get(projectGroup(project.id))!;
    const ownFolders = foldersOf(project.id);
    // A folder being named inside a closed project shows it open.
    const isOpen = !closedProjectIds.has(project.id) || creatingFolderIn === project.id;
    const row: Extract<NotesTreeRow, { kind: "project" }> = {
      kind: "project",
      key: projectSelectionKey(project.id),
      id: project.id,
      project,
      isOpen,
      isEmpty: ownNotes.length === 0 && ownFolders.length === 0,
      lastChildKey: null,
    };
    rows.push(row);
    const first = rows.length;
    for (const note of ownNotes) addNote(note, 1, isOpen);
    for (const folder of ownFolders) addFolder(folder, 1, isOpen);
    if (isOpen) addCreatingFolder(project.id, 1);
    row.lastChildKey = rows.length > first ? rows.at(-1)!.key : null;
  }
  if (!projectScope || projectScope.has(null)) {
    const topNotes = groups.get(TOP_GROUP)!;
    // Under a project, the first note's top edge is a thin target beside the project's own
    // drop; the strip gives the top of the top-level notes a place of its own.
    if (rows.length > 0 && topNotes.length > 0)
      rows.push({ kind: "root-drop", key: "root-drop-start", dropId: NOTES_TREE_START_DROP_ID });
    for (const note of topNotes) addNote(note, 0, true);
    rows.push(rootDropRow);
    for (const folder of foldersOf(null)) addFolder(folder, 0, true);
    addCreatingFolder(null, 0);
  }
  return { rows, keys, scopeKeys };
};

/** Tree rows show only a note's identity, title, place, and order. */
export const notesHaveSameTreeShape = (
  left: readonly NoteDocument[],
  right: readonly NoteDocument[],
) =>
  left.length === right.length &&
  left.every((note, index) => {
    const other = right[index];
    return (
      other?.id === note.id &&
      other.title === note.title &&
      (other.folderId ?? null) === (note.folderId ?? null) &&
      (other.projectId ?? null) === (note.projectId ?? null) &&
      (other.parentNoteId ?? null) === (note.parentNoteId ?? null)
    );
  });

/** Ids to store: those in `ids` that still exist, in the order of `items`. */
export const serializeIds = (ids: ReadonlySet<string>, items: readonly { id: string }[]) =>
  items.filter((item) => ids.has(item.id)).map((item) => item.id);

// Moving by drag and drop.

type Tree<TNote, TFolder, TProject> = {
  notes: readonly TNote[];
  folders: readonly TFolder[];
  projects: readonly TProject[];
};

/**
 * Projects move among projects. Folders move among folders, into a project, or to the top
 * level. Notes move beside other notes, into a folder, a project, another note, or to the
 * top level, but never into themselves or their own sub-notes.
 */
export const canAcceptNotesTreeTarget = ({
  sourceId,
  targetId,
  notes,
  folders,
  projects,
}: Tree<TreeNote, TreeFolder, TreeProject> & { sourceId: string; targetId: string }) => {
  const source = parseDragId(sourceId);
  const target = parseDragId(targetId);
  if (source?.kind === "project") return target?.kind === "project";
  const ontoContainer =
    target?.kind === "folder" || target?.kind === "project" || isTopLevelDropId(targetId);
  if (source?.kind === "folder") return ontoContainer;
  if (source?.kind !== "note") return false;
  if (ontoContainer) return true;
  if (target?.kind !== "note") return false;
  const { parents } = placesOf(folders, projects, notes);
  return (
    notes.some((note) => note.id === source.id) &&
    notes.some((note) => note.id === target.id) &&
    !isInsideNote(parents, target.id, source.id)
  );
};

/** Whether a note dragged onto the middle of a note can go inside it. */
export const canNestNotesTreeTarget = (
  tree: Tree<TreeNote, TreeFolder, TreeProject> & { sourceId: string; targetId: string },
) =>
  parseDragId(tree.sourceId)?.kind === "note" &&
  parseDragId(tree.targetId)?.kind === "note" &&
  canAcceptNotesTreeTarget(tree);

/** A drag changes the note order (and places), the folders, or the projects; one at a time. */
export type NotesTreeMove<TNote, TFolder, TProject> =
  | { kind: "notes"; notes: TNote[] }
  | { kind: "folders"; folders: TFolder[] }
  | { kind: "projects"; projects: TProject[] };

/**
 * Applies a drop. Notes come back in layout order, placed by group with positions renumbered
 * per group; folders and projects come back in their new order. Null when nothing moves.
 */
export const applyNotesTreeMove = <
  TNote extends TreeNote,
  TFolder extends TreeFolder,
  TProject extends TreeProject,
>({
  notes,
  folders,
  projects,
  half,
  inside = false,
  sourceId,
  targetId,
}: Tree<TNote, TFolder, TProject> & {
  half: "before" | "after";
  /** Dropped onto a note's middle: the dragged note goes last inside it. */
  inside?: boolean;
  sourceId: string;
  targetId: string;
}): NotesTreeMove<TNote, TFolder, TProject> | null => {
  const places = placesOf(folders, projects, notes);
  const source = parseDragId(sourceId);
  const target = isTopLevelDropId(targetId) ? null : parseDragId(targetId);
  if (target?.kind === "project" && !places.projectIds.has(target.id)) return null;
  if (target?.kind === "folder" && !places.folderIds.has(target.id)) return null;

  if (source?.kind === "project") {
    if (target?.kind !== "project") return null;
    const moved = applySortableItemMove({
      getId: (project) => project.id,
      half,
      items: sortByPosition(projects),
      sourceId: source.id,
      targetId: target.id,
    });
    return moved ? { kind: "projects", projects: numbered(moved) } : null;
  }

  if (source?.kind === "folder") {
    const folder = folders.find((entry) => entry.id === source.id);
    if (!folder || target?.kind === "note") return null;
    if (target?.kind === "folder") {
      // Dropped beside a folder in another project, the folder moves into that project.
      const targetFolder = folders.find((entry) => entry.id === target.id)!;
      const projectId = places.projectOf(targetFolder.projectId);
      const changesProject = places.projectOf(folder.projectId) !== projectId;
      const ordered =
        applySortableItemMove({
          getId: (entry) => entry.id,
          half,
          items: places.sortedFolders,
          sourceId: source.id,
          targetId: target.id,
        }) ?? (changesProject ? places.sortedFolders : null);
      if (!ordered) return null;
      return {
        kind: "folders",
        folders: numbered(
          ordered.map((entry) =>
            entry.id === folder.id ? { ...entry, projectId: projectId ?? undefined } : entry,
          ),
        ),
      };
    }
    // Onto a project or the top-level strip: the folder goes last there.
    const projectId = target?.kind === "project" ? target.id : null;
    if (places.projectOf(folder.projectId) === projectId) return null;
    return {
      kind: "folders",
      folders: moveFoldersTo(places.sortedFolders, [folder.id], projectId),
    };
  }

  if (source?.kind !== "note") return null;
  const sourceNote = notes.find((note) => note.id === source.id);
  if (!sourceNote) return null;
  const groups = groupNotes(notes, places);
  const sourceGroup = places.groupOf(sourceNote);
  const without = groups.get(sourceGroup)!.filter((note) => note.id !== source.id);
  groups.set(sourceGroup, without);

  if (target?.kind === "note") {
    const targetNote = notes.find((note) => note.id === target.id);
    if (!targetNote || isInsideNote(places.parents, target.id, source.id)) return null;
    if (inside) {
      if (sourceGroup === subNoteGroup(target.id)) return null;
      groups.get(subNoteGroup(target.id))!.push(sourceNote);
    } else {
      // Beside a note in another group, the note moves into that group.
      const siblings = groups.get(places.groupOf(targetNote))!;
      const overIndex = siblings.findIndex((note) => note.id === target.id);
      siblings.splice(half === "before" ? overIndex : overIndex + 1, 0, sourceNote);
    }
  } else {
    // Onto a folder, a project or the top-level strip: the note goes last there; onto the
    // strip above the top-level notes, first.
    const targetGroup = !target
      ? TOP_GROUP
      : target.kind === "folder"
        ? folderGroup(target.id)
        : projectGroup(target.id);
    if (targetId === NOTES_TREE_START_DROP_ID) groups.get(targetGroup)!.unshift(sourceNote);
    else groups.get(targetGroup)!.push(sourceNote);
  }
  return { kind: "notes", notes: flattenGroups(groups, places) };
};

/** Moves folders to the end of a project (null: the top level), keeping their order. */
const moveFoldersTo = <TFolder extends TreeFolder>(
  sortedFolders: readonly TFolder[],
  folderIds: readonly string[],
  projectId: string | null,
) => {
  const ids = new Set(folderIds);
  return numbered([
    ...sortedFolders.filter((folder) => !ids.has(folder.id)),
    ...sortedFolders
      .filter((folder) => ids.has(folder.id))
      .map((folder) => ({ ...folder, projectId: projectId ?? undefined })),
  ]);
};

// Moving from the menu.

/** The notes and folders a project holds directly: its own notes and its folders. */
export const projectContents = ({
  notes,
  folders,
  projectId,
}: {
  notes: readonly TreeNote[];
  folders: readonly TreeFolder[];
  projectId: string;
}) => ({
  noteIds: notes
    .filter(
      (note) =>
        note.projectId === projectId && !folders.some((folder) => folder.id === note.folderId),
    )
    .map((note) => note.id),
  folderIds: folders.filter((folder) => folder.projectId === projectId).map((folder) => folder.id),
});

/**
 * Moves notes to the end of a folder, or out of their folders (null) to the top of the project
 * each is in, in the order the tree shows them. Returns every note in its new place, or null
 * when the folder is gone or nothing moves.
 */
export const moveNotesToFolder = <TNote extends TreeNote>({
  notes,
  folders,
  projects,
  noteIds,
  folderId,
}: Tree<TNote, TreeFolder, TreeProject> & {
  noteIds: readonly string[];
  folderId: string | null;
}) => {
  const places = placesOf(folders, projects, notes);
  if (folderId !== null && !places.folderIds.has(folderId)) return null;
  const targetOf = (note: TNote) => {
    if (folderId) return folderGroup(folderId);
    const projectId = places.noteProject(note);
    return projectId ? projectGroup(projectId) : TOP_GROUP;
  };
  return moveNotesTo({ notes, places, noteIds, targetOf });
};

/**
 * Takes a sub-note out of the note it is inside, to just after that note. Returns every note
 * in its new place, or null when the note is not a sub-note.
 */
export const moveOutOfParent = <TNote extends TreeNote>({
  notes,
  folders,
  projects,
  noteId,
}: Tree<TNote, TreeFolder, TreeProject> & { noteId: string }) => {
  const places = placesOf(folders, projects, notes);
  const parentId = places.parents.get(noteId);
  const parent = notes.find((note) => note.id === parentId);
  const note = notes.find((entry) => entry.id === noteId);
  if (!parent || !note) return null;
  const groups = groupNotes(notes, places);
  const siblings = groups.get(subNoteGroup(parent.id))!;
  siblings.splice(siblings.indexOf(note), 1);
  const outside = groups.get(places.groupOf(parent))!;
  outside.splice(outside.indexOf(parent) + 1, 0, note);
  return flattenGroups(groups, places);
};

/**
 * Moves notes and folders into a project (null: out of every project). Notes leave their
 * folders for the end of the project's own notes; folders go last among its folders. Returns
 * the notes and folders in their new places, or null when nothing moves.
 */
export const moveToProject = <TNote extends TreeNote, TFolder extends TreeFolder>({
  notes,
  folders,
  projects,
  noteIds,
  folderIds,
  projectId,
}: Tree<TNote, TFolder, TreeProject> & {
  noteIds: readonly string[];
  folderIds: readonly string[];
  projectId: string | null;
}) => {
  const places = placesOf(folders, projects, notes);
  if (projectId !== null && !places.projectIds.has(projectId)) return null;
  const target = projectId ? projectGroup(projectId) : TOP_GROUP;
  const movedNotes = moveNotesTo({ notes, places, noteIds, targetOf: () => target });
  const movingFolders = folderIds.filter((folderId) => {
    const folder = folders.find((entry) => entry.id === folderId);
    return folder && places.projectOf(folder.projectId) !== projectId;
  });
  if (!movedNotes && movingFolders.length === 0) return null;
  return {
    notes: movedNotes ?? flattenGroups(groupNotes(notes, places), places),
    folders:
      movingFolders.length > 0
        ? moveFoldersTo(places.sortedFolders, movingFolders, projectId)
        : numbered(places.sortedFolders),
  };
};

const moveNotesTo = <TNote extends TreeNote>({
  notes,
  places,
  noteIds,
  targetOf,
}: {
  notes: readonly TNote[];
  places: Places;
  noteIds: readonly string[];
  targetOf: (note: TNote) => NoteGroup;
}) => {
  const groups = groupNotes(notes, places);
  const ids = new Set(noteIds);
  const moving = places.groupOrder.flatMap((group) =>
    groups.get(group)!.filter((note) => ids.has(note.id) && targetOf(note) !== group),
  );
  if (moving.length === 0) return null;
  const moved = new Set(moving.map((note) => note.id));
  for (const [group, members] of groups)
    groups.set(
      group,
      members.filter((note) => !moved.has(note.id)),
    );
  for (const note of moving) groups.get(targetOf(note))!.push(note);
  return flattenGroups(groups, places);
};

/**
 * Puts notes and folders back where they were in `before`: each note at its earlier index in
 * its earlier group, each folder at its earlier index in its earlier project, around what is
 * there now. Something whose earlier place is gone goes to the top level. Returns the notes
 * and folders in their places, or null when none of them is left.
 */
export const returnToPlaces = <TNote extends TreeNote, TFolder extends TreeFolder>({
  notes,
  folders,
  projects,
  before,
  noteIds,
  folderIds = [],
}: Tree<TNote, TFolder, TreeProject> & {
  before: { notes: readonly TreeNote[]; folders: readonly TreeFolder[] };
  noteIds: readonly string[];
  folderIds?: readonly string[];
}) => {
  const currentNotes = new Map(notes.map((note) => [note.id, note]));
  const currentFolders = new Map(folders.map((folder) => [folder.id, folder]));
  const returningNotes = new Set(noteIds.filter((noteId) => currentNotes.has(noteId)));
  const returningFolders = new Set(folderIds.filter((folderId) => currentFolders.has(folderId)));
  if (returningNotes.size + returningFolders.size === 0) return null;

  // Folders first, since a note returns into its earlier folder.
  const earlierFolders = sortByPosition(before.folders);
  const placedFolders = sortByPosition(folders).filter(
    (folder) => !returningFolders.has(folder.id),
  );
  const projectIds = new Set(projects.map((project) => project.id));
  for (const [index, earlier] of earlierFolders.entries()) {
    if (!returningFolders.has(earlier.id)) continue;
    const projectId =
      earlier.projectId && projectIds.has(earlier.projectId) ? earlier.projectId : undefined;
    placedFolders.splice(Math.min(index, placedFolders.length), 0, {
      ...currentFolders.get(earlier.id)!,
      projectId,
    });
  }
  const nextFolders = numbered(placedFolders);

  const places = placesOf(nextFolders, projects, notes);
  const groups = groupNotes(
    notes.filter((note) => !returningNotes.has(note.id)),
    places,
  );
  const earlierGroups = groupNotes(before.notes, placesOf(before.folders, projects, before.notes));
  const returning = [...earlierGroups].flatMap(([group, members]) =>
    members.flatMap((note, index) =>
      returningNotes.has(note.id)
        ? [
            {
              note: currentNotes.get(note.id)!,
              group: groups.has(group) ? group : TOP_GROUP,
              index,
            },
          ]
        : [],
    ),
  );
  // Lower indexes first, so each note lands where it was among the others put back.
  for (const { note, group, index } of returning.sort((left, right) => left.index - right.index)) {
    const members = groups.get(group)!;
    members.splice(Math.min(index, members.length), 0, note);
  }
  return { notes: flattenGroups(groups, places), folders: nextFolders };
};

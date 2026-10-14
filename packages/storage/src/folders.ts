import type { NoteFolder, NoteProject } from "@loam/shared/notes/noteModel";
import { isRecord } from "@loam/shared/utils/isRecord";

import type { StorageWrite } from "./adapter";
import {
  placeKey,
  placeRow,
  readFolderId,
  readId,
  readProjectId,
  samePlace,
  type NotePlace,
  type NoteRow,
} from "./noteContent";
import { readProjects } from "./projects";
import { invalidRequest } from "./storeError";

/** Every folder, in one `library` record. */
export type FoldersRecord = { folders: NoteFolder[] };

export const FOLDERS_ID = "folders";
const MAX_FOLDER_NAME_LENGTH = 120;

/** A folder name as stored: trimmed, at most 120 characters. */
export const normalizeFolderName = (name: string) =>
  Array.from(name.trim()).slice(0, MAX_FOLDER_NAME_LENGTH).join("");

export const foldersWrite = (folders: NoteFolder[]): StorageWrite => ({
  type: "put",
  collection: "library",
  id: FOLDERS_ID,
  value: { folders } satisfies FoldersRecord,
});

/** A folder as stored: one at the library's top level has no `projectId`. */
export const toFolder = (
  id: string,
  { name, position, projectId }: Omit<NoteFolder, "id">,
): NoteFolder => (projectId ? { id, name, position, projectId } : { id, name, position });

/** Where a layout puts one note. */
type Placement = NotePlace & { id: string };

/** What the library holds before a layout is saved. */
type StoredLayout = {
  projects: readonly NoteProject[];
  folders: readonly NoteFolder[];
  rows: ReadonlyMap<string, NoteRow>;
};

/**
 * Checks a layout the window sends: every project (or none, to keep them),
 * every folder in order, and where notes go. Ids are unique, and folders and
 * notes go only into projects and folders it names. An item that leaves out
 * its project keeps the one it is in, while that one is kept.
 */
export const readLayout = (input: unknown, stored: StoredLayout) => {
  if (!isRecord(input) || !Array.isArray(input.folders) || !Array.isArray(input.notes))
    throw invalidRequest("layout");
  const projects =
    input.projects === undefined ? [...stored.projects] : readProjects(input.projects);
  const projectIds = new Set(projects.map((project) => project.id));
  const projectFor = (value: unknown, current: string | undefined) => {
    if (value === undefined) return current && projectIds.has(current) ? current : undefined;
    const projectId = readProjectId(value);
    if (projectId && !projectIds.has(projectId)) throw invalidRequest("unknown project");
    return projectId;
  };
  const storedFolders = new Map(stored.folders.map((folder) => [folder.id, folder]));
  const folders = input.folders.map((folder, position) => {
    if (!isRecord(folder)) throw invalidRequest("folder");
    const id = readId(folder.id, "folder");
    return toFolder(id, {
      name: normalizeFolderName(typeof folder.name === "string" ? folder.name : ""),
      position,
      projectId: projectFor(folder.projectId, storedFolders.get(id)?.projectId),
    });
  });
  const folderIds = new Set(folders.map((folder) => folder.id));
  if (folderIds.size !== folders.length) throw invalidRequest("two folders share an id");
  // A folder decides its notes' project.
  const currentProject = (row: NoteRow | undefined) =>
    row?.folderId ? storedFolders.get(row.folderId)?.projectId : row?.projectId;
  const placements = input.notes.map((entry): Placement => {
    if (!isRecord(entry)) throw invalidRequest("note placement");
    const id = readId(entry.id, "note");
    const folderId = readFolderId(entry.folderId);
    if (folderId && !folderIds.has(folderId)) throw invalidRequest("unknown folder");
    if (folderId) return { id, folderId };
    return {
      id,
      folderId,
      projectId: projectFor(entry.projectId, currentProject(stored.rows.get(id))),
    };
  });
  /** A note the layout leaves out stays in its folder, or moves to its project's or the top level. */
  const unlistedPlace = (row: NoteRow): NotePlace =>
    row.folderId && folderIds.has(row.folderId)
      ? { folderId: row.folderId }
      : { folderId: null, projectId: projectFor(undefined, currentProject(row)) };
  return { projects, folders, placements, unlistedPlace };
};

/**
 * Every note's row under a new layout. Listed notes go where it says, in its
 * order; unlisted ones follow in their place, in their old order, and notes
 * whose folder or project is gone go last where they move to.
 */
export const arrangeNotes = (
  rows: ReadonlyMap<string, NoteRow>,
  placements: readonly Placement[],
  unlistedPlace: (row: NoteRow) => NotePlace,
) => {
  const next = new Map<string, NoteRow>();
  const positions = new Map<string, number>();
  const place = (row: NoteRow, where: NotePlace) => {
    const key = placeKey(where);
    const position = positions.get(key) ?? 0;
    positions.set(key, position + 1);
    next.set(row.id, placeRow(row, { ...where, position }));
  };
  for (const placement of placements) {
    const row = rows.get(placement.id);
    if (row && !next.has(row.id)) place(row, placement);
  }
  const unlisted = [...rows.values()]
    .filter((row) => !next.has(row.id))
    .sort((left, right) => left.position - right.position)
    .map((row) => ({ row, where: unlistedPlace(row) }));
  for (const { row, where } of unlisted) if (samePlace(row, where)) place(row, where);
  for (const { row, where } of unlisted) if (!samePlace(row, where)) place(row, where);
  return next;
};

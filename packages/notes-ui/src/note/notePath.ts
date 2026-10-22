import type { NoteFolder, NoteProject } from "@loam/shared/notes/noteModel";

import type { NoteDocument } from "../workspace/types";

type PlacedNote = Pick<NoteDocument, "id" | "title" | "folderId" | "projectId" | "parentNoteId">;

/** Where a note sits: its project, its folder, then the notes it is inside, outermost first. */
export type NotePath = {
  project?: NoteProject;
  folder?: NoteFolder;
  parents: PlacedNote[];
};

/**
 * The places above `note`. A sub-note shares its outermost parent's folder and project. A
 * parent missing from the library ends the path there, and a loop of parents stops at the
 * first note seen twice.
 */
export function notePathOf(
  note: PlacedNote,
  library: {
    notes: readonly PlacedNote[];
    folders: readonly NoteFolder[];
    projects: readonly NoteProject[];
  },
): NotePath {
  const notesById = new Map(library.notes.map((entry) => [entry.id, entry]));
  const parents: PlacedNote[] = [];
  const seen = new Set([note.id]);
  let top = note;
  while (top.parentNoteId && !seen.has(top.parentNoteId)) {
    const parent = notesById.get(top.parentNoteId);
    if (!parent) break;
    seen.add(parent.id);
    parents.unshift(parent);
    top = parent;
  }
  const folder = top.folderId
    ? library.folders.find((entry) => entry.id === top.folderId)
    : undefined;
  const projectId = folder ? folder.projectId : top.projectId;
  const project = projectId ? library.projects.find((entry) => entry.id === projectId) : undefined;
  return { project, folder, parents };
}

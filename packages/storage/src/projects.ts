import type { NoteProject } from "@loam/shared/notes/noteModel";
import { MAX_PROJECT_NAME_LENGTH, readNoteProjectIcon } from "@loam/shared/notes/noteProjects";
import { isRecord } from "@loam/shared/utils/isRecord";

import type { StorageWrite } from "./adapter";
import { readId } from "./noteContent";
import { invalidRequest } from "./storeError";

/** Every project, in one `library` record beside the folders. */
export type ProjectsRecord = { projects: NoteProject[] };

export const PROJECTS_ID = "projects";

export const projectsWrite = (projects: NoteProject[]): StorageWrite => ({
  type: "put",
  collection: "library",
  id: PROJECTS_ID,
  value: { projects } satisfies ProjectsRecord,
});

/**
 * A project's fields as stored, from a layout or another device: the name
 * trimmed to at most 120 characters, and the icon only if the app can draw it.
 */
export const readProjectFields = (
  name: unknown,
  icon: unknown,
  position: number,
): Omit<NoteProject, "id"> => {
  const fields = {
    name: Array.from(typeof name === "string" ? name.trim() : "")
      .slice(0, MAX_PROJECT_NAME_LENGTH)
      .join(""),
    position,
  };
  const drawable = readNoteProjectIcon(icon);
  return drawable ? { ...fields, icon: drawable } : fields;
};

/** Checks the projects a layout lists, in order. Their ids are unique. */
export const readProjects = (input: unknown): NoteProject[] => {
  if (!Array.isArray(input)) throw invalidRequest("projects");
  const projects = input.map((project, position) => {
    if (!isRecord(project)) throw invalidRequest("project");
    const id = readId(project.id, "project");
    return { id, ...readProjectFields(project.name, project.icon, position) };
  });
  if (new Set(projects.map((project) => project.id)).size !== projects.length)
    throw invalidRequest("two projects share an id");
  return projects;
};

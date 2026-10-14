import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { NotesBootstrap } from "@loam/shared/notes/noteModel";
import { StoreError } from "@loam/storage/storeError";

import { uuidSchema } from "../requests/params";
import { projectIconSchema, projectNameSchema } from "./schemas";
import type { ToolContext, ToolDefinition } from "./tools";

/**
 * Tools that arrange projects, folders and notes. Each reads the layout,
 * changes one entry and saves it whole, so unrelated entries stay as they are.
 */
export const layoutTools = ({ call, define, noteId, withNotes }: ToolContext): ToolDefinition[] => {
  const layout = async () => {
    const library: NotesBootstrap = await call("notes.library", {});
    return {
      projects: library.projects.map(({ id, name, icon }) => ({ id, name, icon })),
      folders: library.folders.map(({ id, name, projectId }) => ({
        id,
        name,
        projectId: projectId ?? null,
      })),
      notes: library.notes.map(({ id, folderId, projectId }) => ({
        id,
        folderId: folderId ?? null,
        projectId: projectId ?? null,
      })),
    };
  };
  const findProject = (next: Awaited<ReturnType<typeof layout>>, projectId: string) => {
    const project = next.projects.find((entry) => entry.id === projectId);
    if (!project) throw new StoreError("Project not found.", "NOT_FOUND", 404);
    return project;
  };

  return [
    define(
      "loam_projects_create",
      "Create a project, a top-level group of folders and notes, after the existing ones.",
      { name: projectNameSchema, icon: projectIconSchema.optional() },
      async ({ name, icon }) => {
        const next = await layout();
        const id = randomUUID();
        next.projects.push({ id, name, icon });
        const library = await call("notes.saveLayout", { layout: next });
        return library.projects.find((project) => project.id === id);
      },
      withNotes,
    ),
    define(
      "loam_projects_update",
      "Rename a project or change its icon; null removes the icon.",
      {
        projectId: uuidSchema,
        name: projectNameSchema.optional(),
        icon: projectIconSchema.nullable().optional(),
      },
      async ({ projectId, name, icon }) => {
        const next = await layout();
        const project = findProject(next, projectId);
        if (name !== undefined) project.name = name;
        if (icon !== undefined) project.icon = icon ?? undefined;
        return call("notes.saveLayout", { layout: next });
      },
      withNotes,
    ),
    define(
      "loam_projects_move",
      "Move a project before another project, or to the end.",
      { projectId: uuidSchema, beforeProjectId: uuidSchema.optional() },
      async ({ projectId, beforeProjectId }) => {
        const next = await layout();
        const project = findProject(next, projectId);
        next.projects = next.projects.filter((entry) => entry !== project);
        const before =
          beforeProjectId === undefined
            ? next.projects.length
            : next.projects.findIndex((entry) => entry.id === beforeProjectId);
        if (before < 0) throw new StoreError("Project not found.", "NOT_FOUND", 404);
        next.projects.splice(before, 0, project);
        return call("notes.saveLayout", { layout: next });
      },
      withNotes,
    ),
    define(
      "loam_projects_delete",
      "Remove a project and move its folders and notes to the library's top level, preserving all folders and notes.",
      { projectId: uuidSchema },
      async ({ projectId }) => {
        const next = await layout();
        findProject(next, projectId);
        const moveOut = <T extends { projectId: string | null }>(entry: T) =>
          entry.projectId === projectId ? { ...entry, projectId: null } : entry;
        next.projects = next.projects.filter((project) => project.id !== projectId);
        next.folders = next.folders.map(moveOut);
        next.notes = next.notes.map(moveOut);
        return call("notes.saveLayout", { layout: next });
      },
      withNotes,
    ),
    define(
      "loam_folders_create",
      "Create a folder, optionally in a project, without replacing unrelated layout entries.",
      { name: z.string().min(1).max(500), projectId: uuidSchema.nullable().optional() },
      async ({ name, projectId = null }) => {
        const next = await layout();
        if (projectId) findProject(next, projectId);
        const folder = { id: randomUUID(), name, projectId };
        next.folders.push(folder);
        await call("notes.saveLayout", { layout: next });
        return folder;
      },
      withNotes,
    ),
    define(
      "loam_folders_move",
      "Move a folder and its notes into a project, or to the library's top level with null.",
      { folderId: uuidSchema, projectId: uuidSchema.nullable() },
      async ({ folderId, projectId }) => {
        const next = await layout();
        const folder = next.folders.find((entry) => entry.id === folderId);
        if (!folder) throw new StoreError("Folder not found.", "NOT_FOUND", 404);
        if (projectId) findProject(next, projectId);
        folder.projectId = projectId;
        return call("notes.saveLayout", { layout: next });
      },
      withNotes,
    ),
    define(
      "loam_folders_rename",
      "Rename one existing folder.",
      { folderId: uuidSchema, name: z.string().min(1).max(500) },
      async ({ folderId, name }) => {
        const next = await layout();
        const folder = next.folders.find((entry) => entry.id === folderId);
        if (!folder) throw new StoreError("Folder not found.", "NOT_FOUND", 404);
        folder.name = name;
        return call("notes.saveLayout", { layout: next });
      },
      withNotes,
    ),
    define(
      "loam_folders_delete",
      "Remove a folder and move its notes to the top level of its project (or of the library), preserving all notes.",
      { folderId: uuidSchema },
      async ({ folderId }) => {
        const next = await layout();
        const folder = next.folders.find((entry) => entry.id === folderId);
        if (!folder) throw new StoreError("Folder not found.", "NOT_FOUND", 404);
        next.folders = next.folders.filter((entry) => entry !== folder);
        next.notes = next.notes.map((note) =>
          note.folderId === folderId
            ? { ...note, folderId: null, projectId: folder.projectId }
            : note,
        );
        return call("notes.saveLayout", { layout: next });
      },
      withNotes,
    ),
    define(
      "loam_notes_move",
      "Move a note to a folder, or with folderId null to the top level of projectId (null or omitted: the library's top level), optionally before another note in the destination.",
      {
        ...noteId,
        folderId: uuidSchema.nullable(),
        projectId: uuidSchema.nullable().optional(),
        beforeNoteId: uuidSchema.optional(),
      },
      async (input) => {
        const next = await layout();
        const note = next.notes.find((entry) => entry.id === input.noteId);
        if (
          !note ||
          (input.folderId !== null && !next.folders.some((folder) => folder.id === input.folderId))
        )
          throw new StoreError("Note or folder not found.", "NOT_FOUND", 404);
        // A folder decides its notes' project.
        const projectId = input.folderId === null ? (input.projectId ?? null) : null;
        if (projectId) findProject(next, projectId);
        next.notes = next.notes.filter((entry) => entry.id !== input.noteId);
        note.folderId = input.folderId;
        note.projectId = projectId;
        const before =
          input.beforeNoteId === undefined
            ? next.notes.length
            : next.notes.findIndex(
                (entry) =>
                  entry.id === input.beforeNoteId &&
                  entry.folderId === input.folderId &&
                  entry.projectId === projectId,
              );
        if (before < 0)
          throw new StoreError(
            "The destination note is not in that folder or project.",
            "VALIDATION_ERROR",
            400,
          );
        next.notes.splice(before, 0, note);
        return call("notes.saveLayout", { layout: next });
      },
      withNotes,
    ),
  ];
};

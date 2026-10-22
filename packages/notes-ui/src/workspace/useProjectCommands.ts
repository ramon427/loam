import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { NoteProject } from "@loam/shared/notes/noteModel";
import { createUuid } from "@loam/shared/utils/uuid";

import { readLibrary } from "./notesLibrary";
import type { NoteProjectDetails } from "./NotesWorkspace";
import type { LibraryLayout } from "./useLibraryLayout";

/** Adding projects and changing their name and icon. */
export function useProjectCommands({ saveLayout }: LibraryLayout) {
  const queryClient = useQueryClient();

  const createProject = useCallback(
    async ({ name, icon }: NoteProjectDetails) => {
      const library = readLibrary(queryClient);
      const project: NoteProject = {
        id: createUuid(),
        name,
        icon,
        position: library.projects.length,
      };
      await saveLayout(
        { ...library, projects: [...library.projects, project] },
        "Project not created",
      );
      return project;
    },
    [queryClient, saveLayout],
  );

  const updateProject = useCallback(
    async (projectId: string, { name, icon }: NoteProjectDetails) => {
      const library = readLibrary(queryClient);
      await saveLayout(
        {
          ...library,
          projects: library.projects.map((project) =>
            project.id === projectId ? { ...project, name, icon } : project,
          ),
        },
        "Project not changed",
      );
    },
    [queryClient, saveLayout],
  );

  return { createProject, updateProject };
}

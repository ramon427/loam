import { FunnelIcon, LayoutListIcon } from "lucide-react";

import type { NoteFolder, NoteProject } from "@loam/shared/notes/noteModel";

import { sortByPosition } from "../lib/sortByPosition";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/DropdownMenu";

import { NoteProjectIcon } from "./NoteProjectIcon";
import { sidebarActionActiveClass, sidebarActionClass } from "./NotesSidebarCreateActions";
import type { NotesProjectScope } from "./notesTreeModel";

/** Ticking a project shows only the ticked ones; clearing every tick shows them all again. */
const toggleProject = (scope: NotesProjectScope | undefined, projectId: string | null) => {
  const next = new Set(scope);
  if (next.has(projectId)) next.delete(projectId);
  else next.add(projectId);
  return next.size > 0 ? next : undefined;
};

/** Ticking a project keeps the menu open, so several can be ticked in a row. */
const keepOpen = (event: Event) => event.preventDefault();

/**
 * Chooses what the sidebar shows: any mix of projects (and what is outside them), or one
 * folder. A folder scope of null shows only the notes outside folders and projects.
 */
export function NotesSidebarFilter({
  projects,
  folders,
  projectScope,
  folderScopeId,
  onProjectScopeChange,
  onFolderScopeChange,
  disabled,
}: {
  projects: NoteProject[];
  folders: NoteFolder[];
  projectScope: NotesProjectScope | undefined;
  folderScopeId: string | null | undefined;
  onProjectScopeChange: (scope: NotesProjectScope | undefined) => void;
  onFolderScopeChange: (folderId: string | null | undefined) => void;
  disabled?: boolean;
}) {
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const isFiltered = folderScopeId !== undefined || projectScope !== undefined;
  let scopeLabel = "All notes";
  if (folderScopeId === null) scopeLabel = "Unfiled notes";
  else if (folderScopeId !== undefined)
    scopeLabel = folders.find((folder) => folder.id === folderScopeId)?.name ?? scopeLabel;
  else if (projectScope)
    scopeLabel = [...projectScope]
      .map((projectId) => (projectId ? projectsById.get(projectId)?.name : "No project"))
      .filter(Boolean)
      .join(", ");
  const label = `Filter notes: ${scopeLabel}`;

  // Choosing projects leaves a folder view, and choosing a folder leaves the projects chosen.
  const chooseProject = (projectId: string | null) => {
    onFolderScopeChange(undefined);
    onProjectScopeChange(toggleProject(projectScope, projectId));
  };
  const chooseFolder = (folderId: string | null) => {
    onProjectScopeChange(undefined);
    onFolderScopeChange(folderScopeId === folderId ? undefined : folderId);
  };
  const isProjectShown = (projectId: string | null) =>
    folderScopeId === undefined && projectScope?.has(projectId) === true;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost-muted"
          size="icon-sm"
          className={cn(sidebarActionClass, isFiltered && sidebarActionActiveClass)}
          aria-label={label}
          title={label}
          disabled={disabled}
        >
          <FunnelIcon className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] min-w-52 max-w-72 overflow-y-auto">
        <DropdownMenuCheckboxItem
          checked={!isFiltered}
          onCheckedChange={() => {
            onProjectScopeChange(undefined);
            onFolderScopeChange(undefined);
          }}
        >
          All notes
        </DropdownMenuCheckboxItem>
        {projects.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Projects</DropdownMenuLabel>
            {sortByPosition(projects).map((project) => (
              <DropdownMenuCheckboxItem
                key={project.id}
                checked={isProjectShown(project.id)}
                onSelect={keepOpen}
                onCheckedChange={() => chooseProject(project.id)}
              >
                <NoteProjectIcon icon={project.icon} />
                <span className="truncate">{project.name}</span>
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuCheckboxItem
              checked={isProjectShown(null)}
              onSelect={keepOpen}
              onCheckedChange={() => chooseProject(null)}
            >
              <LayoutListIcon className="size-4 shrink-0" aria-hidden="true" />
              No project
            </DropdownMenuCheckboxItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Folder</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={folderScopeId === null}
          onCheckedChange={() => chooseFolder(null)}
        >
          Unfiled notes
        </DropdownMenuCheckboxItem>
        {sortByPosition(folders).map((folder) => {
          const project = folder.projectId ? projectsById.get(folder.projectId) : undefined;
          return (
            <DropdownMenuCheckboxItem
              key={folder.id}
              checked={folderScopeId === folder.id}
              onCheckedChange={() => chooseFolder(folder.id)}
            >
              <span className="truncate">{folder.name}</span>
              {project ? (
                <span className="ml-auto truncate pl-2 text-xs text-(--app-muted)">
                  {project.name}
                </span>
              ) : null}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

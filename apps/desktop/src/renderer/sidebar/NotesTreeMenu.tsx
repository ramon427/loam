import {
  CopyPlusIcon,
  FileOutputIcon,
  FolderIcon,
  FolderInputIcon,
  FolderOutputIcon,
  FolderPlusIcon,
  HistoryIcon,
  LayoutListIcon,
  LinkIcon,
  ListChecksIcon,
  PackageIcon,
  PackageMinusIcon,
  PackagePlusIcon,
  PencilIcon,
  Redo2Icon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";

import { buildNoteHref } from "@loam/shared/notes/noteLinks";
import type { NoteFolder, NoteProject } from "@loam/shared/notes/noteModel";

import { ActionMenuItem, ActionMenuSub } from "../action-menu/ActionMenu";
import { copyLink } from "../lib/copyLink";
import { ContextMenuSeparator } from "../ui/ContextMenu";
import { NoteRouteGlyph } from "../ui/NoteRouteIcon";
import type { NoteDocument } from "../workspace/types";

import { NoteProjectIcon } from "./NoteProjectIcon";
import {
  folderSelectionKey,
  getNoteTitle,
  noteSelectionKey,
  projectIdFromSelectionKey,
  treeItemFromSelectionKey,
  type NotesDeleteCandidate,
  type NotesTreeItem,
} from "./notesTreeModel";
import type { NotesTreeCommands } from "./useNotesTreeCommands";

export type NotesTreeMenuContext = {
  commands: NotesTreeCommands;
  notesById: ReadonlyMap<string, NoteDocument>;
  foldersById: ReadonlyMap<string, NoteFolder>;
  projectsById: ReadonlyMap<string, NoteProject>;
  /** Every folder, in the tree's order. */
  folders: readonly NoteFolder[];
  /** Every project, in the tree's order. */
  projects: readonly NoteProject[];
  /** The folder a new top-level note goes in while the sidebar shows one folder. */
  folderScopeId: string | null | undefined;
  /** The project new notes and folders go in while the sidebar shows only that one. */
  scopedProjectId: string | undefined;
  deleteCandidate: (keys: Iterable<string>) => NotesDeleteCandidate | null;
  openFolder: (folderId: string) => void;
  openProject: (projectId: string) => void;
  selectAll: () => void;
  openHistory: (note: NoteDocument) => void;
  exportNote: (noteId: string) => void;
  isExporting: boolean;
};

/** The tree's own undo history, which ends every menu after the actions on what was clicked. */
function HistoryItems({ commands }: { commands: NotesTreeCommands }) {
  return (
    <>
      <ContextMenuSeparator />
      <ActionMenuItem
        icon={<Undo2Icon aria-hidden="true" />}
        shortcut="edit.undo"
        disabled={!commands.canUndo}
        onSelect={() => void commands.undo()}
      >
        {commands.undoLabel}
      </ActionMenuItem>
      <ActionMenuItem
        icon={<Redo2Icon aria-hidden="true" />}
        shortcut="edit.redo"
        disabled={!commands.canRedo}
        onSelect={() => void commands.redo()}
      >
        {commands.redoLabel}
      </ActionMenuItem>
    </>
  );
}

/**
 * Moves notes out of their folders or into one; the place they all are already is disabled.
 * A folder in a project names the project too.
 */
function MoveToFolderMenu({
  notes,
  context,
}: {
  notes: NoteDocument[];
  context: NotesTreeMenuContext;
}) {
  const places = new Set(
    notes.map((note) =>
      note.folderId && context.foldersById.has(note.folderId) ? note.folderId : null,
    ),
  );
  const isCurrent = (folderId: string | null) => places.size === 1 && places.has(folderId);
  const move = (folderId: string | null) => {
    if (folderId) context.openFolder(folderId);
    void context.commands.moveNotes(
      notes.map((note) => note.id),
      folderId,
    );
  };
  return (
    <ActionMenuSub label="Move to folder" icon={<FolderInputIcon aria-hidden="true" />}>
      <ActionMenuItem
        icon={<FolderOutputIcon aria-hidden="true" />}
        disabled={isCurrent(null)}
        onSelect={() => move(null)}
      >
        No folder
      </ActionMenuItem>
      {context.folders.map((folder) => {
        const project = folder.projectId ? context.projectsById.get(folder.projectId) : undefined;
        return (
          <ActionMenuItem
            key={folder.id}
            icon={<FolderIcon aria-hidden="true" />}
            disabled={isCurrent(folder.id)}
            onSelect={() => move(folder.id)}
          >
            {folder.name}
            {project ? <span className="ml-2 text-(--app-muted)">{project.name}</span> : null}
          </ActionMenuItem>
        );
      })}
    </ActionMenuSub>
  );
}

/**
 * Moves notes and folders into a project or out of every project; the project they all are
 * in already is disabled. Notes leave their folders.
 */
function MoveToProjectMenu({
  items,
  context,
}: {
  items: readonly NotesTreeItem[];
  context: NotesTreeMenuContext;
}) {
  if (context.projects.length === 0) return null;
  const projectOf = (item: NotesTreeItem) => {
    if (item.kind === "folder") return context.foldersById.get(item.id)?.projectId ?? null;
    const note = context.notesById.get(item.id);
    const folder = note?.folderId ? context.foldersById.get(note.folderId) : undefined;
    return (folder ? folder.projectId : note?.projectId) ?? null;
  };
  const places = new Set(items.map(projectOf));
  const isCurrent = (projectId: string | null) => places.size === 1 && places.has(projectId);
  const move = (projectId: string | null) => {
    if (projectId) context.openProject(projectId);
    void context.commands.moveItemsToProject(
      {
        noteIds: items.filter((item) => item.kind === "note").map((item) => item.id),
        folderIds: items.filter((item) => item.kind === "folder").map((item) => item.id),
      },
      projectId,
    );
  };
  return (
    <ActionMenuSub label="Move to project" icon={<PackageIcon aria-hidden="true" />}>
      <ActionMenuItem
        icon={<LayoutListIcon aria-hidden="true" />}
        disabled={isCurrent(null)}
        onSelect={() => move(null)}
      >
        No project
      </ActionMenuItem>
      {context.projects.map((project) => (
        <ActionMenuItem
          key={project.id}
          icon={<NoteProjectIcon icon={project.icon} />}
          disabled={isCurrent(project.id)}
          onSelect={() => move(project.id)}
        >
          {project.name}
        </ActionMenuItem>
      ))}
    </ActionMenuSub>
  );
}

/** A project's menu: make something in it, change it, or remove it (keeping what it holds). */
function ProjectMenu({
  project,
  context,
}: {
  project: NoteProject;
  context: NotesTreeMenuContext;
}) {
  const { commands } = context;
  return (
    <>
      <ActionMenuItem
        icon={<NoteRouteGlyph />}
        onSelect={() => {
          context.openProject(project.id);
          void commands.createNote({ projectId: project.id });
        }}
      >
        New note
      </ActionMenuItem>
      <ActionMenuItem
        icon={<FolderPlusIcon aria-hidden="true" />}
        onSelect={() => commands.startFolderCreation(project.id)}
      >
        New folder
      </ActionMenuItem>
      <ActionMenuItem
        icon={<PencilIcon aria-hidden="true" />}
        onSelect={() => commands.startProjectEdit(project)}
      >
        Edit project…
      </ActionMenuItem>
      <ContextMenuSeparator />
      <ActionMenuItem
        icon={<PackageMinusIcon aria-hidden="true" />}
        destructive
        onSelect={() => void commands.removeProject(project.id)}
      >
        Remove project
      </ActionMenuItem>
      <HistoryItems commands={commands} />
    </>
  );
}

/**
 * The tree's right-click menu. `keys` are the rows it acts on: the right-clicked row, or the
 * whole selection when that row is part of it; none for empty space.
 */
export function NotesTreeMenu({
  keys,
  context,
}: {
  keys: readonly string[];
  context: NotesTreeMenuContext;
}) {
  const { commands } = context;
  const projectId = keys.length === 1 ? projectIdFromSelectionKey(keys[0]!) : null;
  const project = projectId ? context.projectsById.get(projectId) : undefined;
  const item = keys.length === 1 ? treeItemFromSelectionKey(keys[0]!) : null;
  const note = item?.kind === "note" ? context.notesById.get(item.id) : undefined;
  const folder = item?.kind === "folder" ? context.foldersById.get(item.id) : undefined;
  // A row whose item was just removed has nothing to act on.
  if ((projectId && !project) || (item && !note && !folder)) return null;
  const history = <HistoryItems commands={commands} />;

  if (project) return <ProjectMenu project={project} context={context} />;

  if (keys.length > 1) {
    const items = keys.flatMap((key) => treeItemFromSelectionKey(key) ?? []);
    const selectedNotes = items.every((entry) => entry.kind === "note")
      ? items.flatMap((entry) => context.notesById.get(entry.id) ?? [])
      : [];
    return (
      <>
        {selectedNotes.length > 0 ? (
          <MoveToFolderMenu notes={selectedNotes} context={context} />
        ) : null}
        <MoveToProjectMenu items={items} context={context} />
        <ActionMenuItem icon={<ListChecksIcon aria-hidden="true" />} onSelect={context.selectAll}>
          Select all
        </ActionMenuItem>
        <ContextMenuSeparator />
        <ActionMenuItem
          icon={<Trash2Icon aria-hidden="true" />}
          destructive
          onSelect={() => commands.requestDelete(context.deleteCandidate(keys))}
        >
          Delete selected
        </ActionMenuItem>
        {history}
      </>
    );
  }

  if (note) {
    return (
      <>
        <ActionMenuItem
          icon={<PencilIcon aria-hidden="true" />}
          onSelect={() => commands.startRename({ kind: "note", id: note.id }, note.title)}
        >
          Rename note
        </ActionMenuItem>
        <ActionMenuItem
          icon={<CopyPlusIcon aria-hidden="true" />}
          onSelect={() => void commands.duplicateNote(note)}
        >
          Duplicate note
        </ActionMenuItem>
        <ActionMenuItem
          icon={<LinkIcon aria-hidden="true" />}
          onSelect={() => void copyLink(buildNoteHref(note.id), getNoteTitle(note))}
        >
          Copy link
        </ActionMenuItem>
        <MoveToFolderMenu notes={[note]} context={context} />
        <MoveToProjectMenu items={[{ kind: "note", id: note.id }]} context={context} />
        <ContextMenuSeparator />
        <ActionMenuItem
          icon={<HistoryIcon aria-hidden="true" />}
          onSelect={() => context.openHistory(note)}
        >
          Version history…
        </ActionMenuItem>
        <ActionMenuItem
          icon={<FileOutputIcon aria-hidden="true" />}
          disabled={context.isExporting}
          onSelect={() => context.exportNote(note.id)}
        >
          Export as Markdown…
        </ActionMenuItem>
        <ContextMenuSeparator />
        <ActionMenuItem
          icon={<Trash2Icon aria-hidden="true" />}
          destructive
          onSelect={() =>
            commands.requestDelete(context.deleteCandidate([noteSelectionKey(note.id)]))
          }
        >
          Delete note
        </ActionMenuItem>
        {history}
      </>
    );
  }

  if (folder) {
    return (
      <>
        <ActionMenuItem
          icon={<NoteRouteGlyph />}
          onSelect={() => {
            context.openFolder(folder.id);
            void commands.createNote({ folderId: folder.id });
          }}
        >
          New note
        </ActionMenuItem>
        <ActionMenuItem
          icon={<PencilIcon aria-hidden="true" />}
          onSelect={() => commands.startRename({ kind: "folder", id: folder.id }, folder.name)}
        >
          Rename folder
        </ActionMenuItem>
        <MoveToProjectMenu items={[{ kind: "folder", id: folder.id }]} context={context} />
        <ContextMenuSeparator />
        <ActionMenuItem
          icon={<Trash2Icon aria-hidden="true" />}
          destructive
          onSelect={() =>
            commands.requestDelete(context.deleteCandidate([folderSelectionKey(folder.id)]))
          }
        >
          Delete folder
        </ActionMenuItem>
        {history}
      </>
    );
  }

  return (
    <>
      <ActionMenuItem
        icon={<NoteRouteGlyph />}
        onSelect={() =>
          void commands.createNote({
            folderId: context.folderScopeId ?? undefined,
            projectId: context.scopedProjectId,
          })
        }
      >
        New note
      </ActionMenuItem>
      <ActionMenuItem
        icon={<FolderPlusIcon aria-hidden="true" />}
        onSelect={() => commands.startFolderCreation(context.scopedProjectId ?? null)}
      >
        New folder
      </ActionMenuItem>
      <ActionMenuItem
        icon={<PackagePlusIcon aria-hidden="true" />}
        onSelect={commands.startProjectCreation}
      >
        New project…
      </ActionMenuItem>
      {history}
    </>
  );
}

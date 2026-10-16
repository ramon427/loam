import {
  CopyPlusIcon,
  CornerLeftUpIcon,
  FilePlusIcon,
  FolderInputIcon,
  FolderPlusIcon,
  HistoryIcon,
  LinkIcon,
  ListChecksIcon,
  PackageMinusIcon,
  PackagePlusIcon,
  PencilIcon,
  Redo2Icon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";

import { buildNoteHref } from "@loam/shared/notes/noteLinks";
import type { NoteFolder, NoteProject } from "@loam/shared/notes/noteModel";

import { ActionMenuItem } from "../action-menu/ActionMenu";
import { copyLink } from "../lib/copyLink";
import { ContextMenuSeparator } from "../ui/ContextMenu";
import { NoteRouteGlyph } from "../ui/NoteRouteIcon";
import type { NoteDocument } from "../workspace/types";

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
  /** Shows a note's sub-notes in the tree. */
  openSubNotes: (noteId: string) => void;
  selectAll: () => void;
  openHistory: (note: NoteDocument) => void;
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

/** "Move to…" for notes or folders: one picker of folders and projects (NotesMoveDialog). */
function MoveItem({
  items,
  context,
}: {
  items: readonly NotesTreeItem[];
  context: NotesTreeMenuContext;
}) {
  // A folder can only change project.
  const onlyProjects = items.some((item) => item.kind === "folder");
  if (onlyProjects && context.projects.length === 0) return null;
  return (
    <ActionMenuItem
      icon={<FolderInputIcon aria-hidden="true" />}
      onSelect={() => context.commands.requestMove(items)}
    >
      Move to…
    </ActionMenuItem>
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
    return (
      <>
        <MoveItem items={items} context={context} />
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
    const parent = note.parentNoteId ? context.notesById.get(note.parentNoteId) : undefined;
    return (
      <>
        <ActionMenuItem
          icon={<FilePlusIcon aria-hidden="true" />}
          onSelect={() => {
            context.openSubNotes(note.id);
            void commands.createNote({ parentNoteId: note.id });
          }}
        >
          New sub-note
        </ActionMenuItem>
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
        {parent ? (
          <ActionMenuItem
            icon={<CornerLeftUpIcon aria-hidden="true" />}
            onSelect={() => void commands.moveOutOfParent(note.id)}
          >
            {`Move out of “${getNoteTitle(parent)}”`}
          </ActionMenuItem>
        ) : null}
        <MoveItem items={[{ kind: "note", id: note.id }]} context={context} />
        <ContextMenuSeparator />
        <ActionMenuItem
          icon={<HistoryIcon aria-hidden="true" />}
          onSelect={() => context.openHistory(note)}
        >
          Version history…
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
        <MoveItem items={[{ kind: "folder", id: folder.id }]} context={context} />
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

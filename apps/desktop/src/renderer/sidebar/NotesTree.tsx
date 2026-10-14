import { FolderPlusIcon } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import {
  ActionMenuContent,
  isActionMenuTarget,
  leaveToNativeMenu,
} from "../action-menu/ActionMenu";
import { useMarkdownExport } from "../import-export/useMarkdownExport";
import { useNotesWorkspace } from "../workspace/NotesWorkspace";
import type { NoteDocument } from "../workspace/types";
import { isEditableTarget, matchesShortcut, shortcuts } from "../keyboard/shortcuts";
import { useNativeSortableList } from "../lib/nativeSortable";
import { Button } from "../ui/Button";
import { ContextMenu, ContextMenuTrigger } from "../ui/ContextMenu";
import { EmptyState } from "../ui/EmptyState";
import { NoteRouteGlyph } from "../ui/NoteRouteIcon";

import { NotesProjectDialog } from "./NotesProjectDialog";
import { NotesSidebarDeleteDialog } from "./NotesSidebarDeleteDialog";
import { NotesTreeMenu } from "./NotesTreeMenu";
import {
  applyNotesTreeMove,
  canAcceptNotesTreeTarget,
  containerFromDragId,
  deleteCandidateFromKeys,
  folderDragId,
  noteDragId,
  NOTES_TREE_ROOT_DROP_ID,
  notesTreeRowHeight,
  projectDragId,
  scopedProjectOf,
  type NotesProjectScope,
  type NotesTreeItem,
  type NotesTreeRow,
} from "./notesTreeModel";
import { FolderRow, NewFolderRow, NoteRow, ProjectRow, RootDropZone } from "./NotesTreeRows";
import { useNotesTree } from "./useNotesTree";
import { useNotesTreeCommands } from "./useNotesTreeCommands";
import { useNotesTreeSelection } from "./useNotesTreeSelection";

export type NotesTreeProps = {
  /** Undefined defers to the project scope; null shows top-level notes; an id one folder. */
  folderScopeId?: string | null;
  /** The projects shown (null: what is outside projects); undefined shows all of them. */
  projectScope?: NotesProjectScope;
  onOpenHistory: (note: NoteDocument) => void;
};

const dragIdOf = (row: NotesTreeRow) => {
  if (row.kind === "project") return projectDragId(row.id);
  if (row.kind === "folder") return folderDragId(row.id);
  return row.kind === "note" ? noteDragId(row.id) : null;
};

/**
 * The notes tree: projects, folders and notes to open, select, rename, delete, and drag into
 * order.
 */
export function NotesTree({ folderScopeId, projectScope, onOpenHistory }: NotesTreeProps) {
  const { notes, folders, projects, activeNoteId, openNote, rearrange } = useNotesWorkspace();
  const commands = useNotesTreeCommands();
  const { editing } = commands;
  const tree = useNotesTree({
    notes,
    folders,
    projects,
    activeNoteId,
    folderScopeId,
    projectScope,
    creatingFolderIn: editing?.kind === "new-folder" ? editing.projectId : undefined,
  });
  const selection = useNotesTreeSelection({
    rows: tree.rows,
    visibleKeys: tree.keys,
    scopeKeys: tree.scopeKeys,
    activeNoteId,
    onSelectNote: openNote,
  });
  const { exportNotes, isExporting } = useMarkdownExport();
  const scrollRef = useRef<HTMLDivElement>(null);

  const exists = (item: NotesTreeItem) =>
    item.kind === "note" ? tree.notesById.has(item.id) : tree.foldersById.has(item.id);
  const deleteCandidate = (keys: Iterable<string>) => deleteCandidateFromKeys(keys, exists);

  // TanStack Virtual returns an imperative object the React Compiler cannot check.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: tree.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => notesTreeRowHeight(tree.rows[index]!),
    getItemKey: (index) => tree.rows[index]!.key,
    overscan: 8,
  });

  const placed = {
    notes: tree.sortedNotes,
    folders: tree.sortedFolders,
    projects: tree.sortedProjects,
  };
  const sortable = useNativeSortableList({
    instanceId: "notes-tree",
    canAcceptTarget: (sourceId, targetId) =>
      canAcceptNotesTreeTarget({ ...placed, sourceId, targetId }),
    onMove: ({ sourceId, targetId, half }) => {
      const move = applyNotesTreeMove({ ...placed, sourceId, targetId, half });
      if (!move) return false;
      // What is dropped into a folder or project shows there.
      const container = containerFromDragId(targetId);
      if (container?.kind === "folder" && move.kind === "notes") tree.openFolder(container.id);
      if (container?.kind === "project" && move.kind !== "projects") tree.openProject(container.id);
      if (move.kind === "notes") void rearrange({ notes: move.notes }, "Note not moved");
      else if (move.kind === "folders")
        void rearrange({ folders: move.folders }, "Folder not moved");
      else void rearrange({ projects: move.projects }, "Project not moved");
    },
  });

  const [menuKeys, setMenuKeys] = useState<readonly string[]>([]);
  const handleContextMenuCapture = (event: ReactMouseEvent) => {
    if (!isActionMenuTarget(event)) leaveToNativeMenu(event);
    else setMenuKeys(selection.selectForContextMenu(event.target));
  };

  const handleKeyDown = (event: ReactKeyboardEvent) => {
    // A text field, such as the rename field, keeps its own keys and text undo.
    if (isEditableTarget(event.target)) return;
    if (matchesShortcut(event.nativeEvent, shortcuts["edit.undo"])) {
      event.preventDefault();
      void commands.undo();
      return;
    }
    if (matchesShortcut(event.nativeEvent, shortcuts["edit.redo"])) {
      event.preventDefault();
      void commands.redo();
      return;
    }
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    const candidate = deleteCandidate(selection.selected);
    if (!candidate) return;
    event.preventDefault();
    commands.requestDelete(candidate);
  };

  // A drop after an open folder or project lands after what it holds, so the line is drawn
  // under its last row.
  const marker = sortable.marker;
  const dropAfterKey =
    marker?.half === "after"
      ? tree.rows.find(
          (row): row is Extract<NotesTreeRow, { kind: "folder" | "project" }> =>
            (row.kind === "folder" || row.kind === "project") && dragIdOf(row) === marker.targetId,
        )?.lastChildKey
      : null;
  const dropMarkerOf = (row: NotesTreeRow, marked: "before" | "after" | undefined) => {
    if (row.key === dropAfterKey) return "after";
    return "lastChildKey" in row && row.lastChildKey ? undefined : marked;
  };

  const editProps = (item: NotesTreeItem) => ({
    isEditing: editing?.kind === item.kind && editing.id === item.id,
    onCommitEdit: (name: string) => void commands.commitEdit(name),
    onCancelEdit: commands.cancelEdit,
  });

  const renderRow = (row: NotesTreeRow) => {
    const animateEntry = tree.enteringKeys.has(row.key);
    if (row.kind === "root-drop") {
      return <RootDropZone zoneProps={sortable.zoneProps(NOTES_TREE_ROOT_DROP_ID, "before")} />;
    }
    if (row.kind === "creating-folder") {
      return (
        <NewFolderRow
          depth={row.depth}
          animateEntry={animateEntry}
          onCommit={(name) => void commands.commitEdit(name)}
          onCancel={commands.cancelEdit}
        />
      );
    }
    if (row.kind === "project") {
      const dragItem = sortable.itemProps(projectDragId(row.id));
      return (
        <ProjectRow
          project={row.project}
          isOpen={row.isOpen}
          isEmpty={row.isEmpty}
          animateEntry={animateEntry}
          sortable={dragItem}
          dropMarker={dropMarkerOf(row, dragItem["data-drop-marker"])}
          onClick={() => tree.toggleProject(row.id)}
        />
      );
    }
    if (row.kind === "folder") {
      const item = { kind: "folder", id: row.id } as const;
      const dragItem = sortable.itemProps(folderDragId(row.id));
      return (
        <FolderRow
          folder={row.folder}
          depth={row.depth}
          isOpen={row.isOpen}
          isSelected={selection.selected.has(row.key)}
          animateEntry={animateEntry}
          sortable={dragItem}
          dropMarker={dropMarkerOf(row, dragItem["data-drop-marker"])}
          onClick={(event) => {
            if (selection.click(item, event)) tree.toggleFolder(row.id);
          }}
          {...editProps(item)}
        />
      );
    }
    const item = { kind: "note", id: row.id } as const;
    const { isEditing, ...edit } = editProps(item);
    const dragItem = sortable.itemProps(noteDragId(row.id), !isEditing);
    return (
      <NoteRow
        note={row.note}
        depth={row.depth}
        isActive={row.id === activeNoteId}
        isSelected={selection.selected.has(row.key)}
        animateEntry={animateEntry}
        sortable={dragItem}
        dropMarker={dropMarkerOf(row, dragItem["data-drop-marker"])}
        onClick={(event) => selection.selectNote(row.id, event)}
        isEditing={isEditing}
        {...edit}
      />
    );
  };

  const isEmpty = notes.length === 0 && folders.length === 0 && projects.length === 0 && !editing;
  const hasNoUnfiledNotes =
    folderScopeId === null && !isEmpty && !editing && !tree.rows.some((row) => row.kind === "note");

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <nav
            aria-label="Notes"
            className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden select-none"
            onContextMenuCapture={handleContextMenuCapture}
            onKeyDown={handleKeyDown}
          >
            <div
              ref={scrollRef}
              aria-label="Notes tree selection area"
              className="relative min-h-0 flex-1 overflow-y-auto pb-2"
              role="group"
              {...selection.marqueeProps}
            >
              {hasNoUnfiledNotes ? (
                <p className="px-2 py-7 text-center text-xs text-(--app-muted)">
                  No unfiled notes.
                </p>
              ) : null}
              {isEmpty ? (
                <EmptyState
                  size="sm"
                  title="Create your first note"
                  description="Right-click here anytime to add notes or folders."
                  className="px-2 py-7"
                  action={
                    <div className="flex flex-col gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          void commands.createNote({ folderId: folderScopeId ?? undefined })
                        }
                      >
                        <NoteRouteGlyph className="size-3.5" />
                        New note
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => commands.startFolderCreation()}
                      >
                        <FolderPlusIcon className="size-3.5" aria-hidden="true" />
                        New folder
                      </Button>
                    </div>
                  }
                />
              ) : null}
              <ul className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const row = tree.rows[virtualRow.index]!;
                  return (
                    <li
                      key={row.key}
                      className="absolute top-0 left-0 w-full"
                      style={{
                        height: virtualRow.size,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      {renderRow(row)}
                    </li>
                  );
                })}
              </ul>
              {selection.marqueeStyle ? (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute z-20 rounded-md border border-(--app-accent)/45 bg-(--app-accent)/10 shadow-sm"
                  style={selection.marqueeStyle}
                />
              ) : null}
            </div>
          </nav>
        </ContextMenuTrigger>
        <ActionMenuContent aria-label="Notes actions">
          <NotesTreeMenu
            keys={menuKeys}
            context={{
              commands,
              notesById: tree.notesById,
              foldersById: tree.foldersById,
              projectsById: tree.projectsById,
              folders: tree.sortedFolders,
              projects: tree.sortedProjects,
              folderScopeId,
              scopedProjectId: scopedProjectOf(projectScope),
              deleteCandidate,
              openFolder: tree.openFolder,
              openProject: tree.openProject,
              selectAll: selection.selectAll,
              openHistory: onOpenHistory,
              exportNote: (noteId) => void exportNotes({ kind: "note", noteId }),
              isExporting,
            }}
          />
        </ActionMenuContent>
      </ContextMenu>

      <NotesProjectDialog
        state={commands.projectDialog}
        onClose={commands.closeProjectDialog}
        onSubmit={(details) => void commands.submitProjectDialog(details)}
      />
      <NotesSidebarDeleteDialog
        candidate={commands.deleteRequest}
        notesById={tree.notesById}
        foldersById={tree.foldersById}
        isDeleting={commands.isDeleting}
        onCancel={() => commands.requestDelete(null)}
        onConfirm={commands.confirmDelete}
      />
    </>
  );
}

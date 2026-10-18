import { ChevronRightIcon, FolderIcon, FolderOpenIcon } from "lucide-react";
import { m } from "framer-motion";
import { useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";

import type { NoteFolder, NoteProject } from "@loam/shared/notes/noteModel";

import type { useNativeSortableList } from "../lib/nativeSortable";
import { FAST_MOTION_MS } from "../styles/motion";
import { cn } from "../ui/cn";
import { Input } from "../ui/Input";
import { NoteRouteGlyph } from "../ui/NoteRouteIcon";
import { SidebarRow } from "../ui/SidebarRow";
import type { NoteDocument } from "../workspace/types";

import { NoteProjectIcon } from "./NoteProjectIcon";
import {
  folderSelectionKey,
  getNoteTitle,
  MAX_FOLDER_NAME_LENGTH,
  MAX_NOTE_TITLE_LENGTH,
  noteSelectionKey,
  projectSelectionKey,
} from "./notesTreeModel";

type SortableList = ReturnType<typeof useNativeSortableList>;
type SortableItemProps = ReturnType<SortableList["itemProps"]>;
type DropMarker = "before" | "after" | "inside" | undefined;

/**
 * Each level in steps in 12px. A note's icon lines up with the folder and project icons of
 * its level, which sit after their chevron.
 */
const containerIndent = (depth: number) => ({ paddingLeft: `${4 + 12 * depth}px` });
const noteIndent = (depth: number) => ({ paddingLeft: `${26 + 12 * depth}px` });

const Chevron = ({ isOpen }: { isOpen: boolean }) => (
  <span
    className={cn(
      "flex size-3.5 shrink-0 items-center justify-center transition-transform",
      isOpen && "rotate-90",
    )}
    aria-hidden="true"
  >
    <ChevronRightIcon className="size-3.5" />
  </span>
);

const entryTransition = {
  opacity: { duration: FAST_MOTION_MS / 1000, ease: "easeOut" },
  y: { duration: FAST_MOTION_MS / 1000, ease: "easeOut" },
} as const;

/**
 * Fades a row in when it mounts new to the tree. The target stays the same
 * after mount, so a re-render mid-fade, once the row no longer counts as new,
 * can't stop the fade part way.
 */
const TreeRowEntry = ({ fadeIn, children }: { fadeIn: boolean; children: ReactNode }) => (
  <m.div
    initial={fadeIn ? { opacity: 0, y: 2 } : false}
    animate={{ opacity: 1, y: 0 }}
    transition={entryTransition}
  >
    {children}
  </m.div>
);

/**
 * Names an item in place. Enter (or Ctrl/Cmd+S) or clicking elsewhere commits
 * once; Escape cancels.
 */
function TreeNameInput({
  label,
  initialValue,
  maxLength,
  autoSelect = false,
  onCommit,
  onCancel,
}: {
  label: string;
  initialValue: string;
  maxLength: number;
  autoSelect?: boolean;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const doneRef = useRef(false);
  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (commit) onCommit(value);
    else onCancel();
  };

  return (
    <Input
      surface="plain"
      aria-label={label}
      autoFocus
      style={{ backgroundColor: "transparent", color: "inherit", font: "inherit" }}
      className="h-auto min-h-0 min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-[inherit] leading-[inherit] font-[inherit] text-(--app-text) shadow-none"
      maxLength={maxLength}
      placeholder={label}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => {
        if (autoSelect) event.currentTarget.select();
      }}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        const isModSave =
          event.key.toLowerCase() === "s" &&
          (event.metaKey || event.ctrlKey) &&
          !event.altKey &&
          !event.shiftKey;
        if (event.key === "Enter" || isModSave) {
          event.preventDefault();
          finish(true);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
    />
  );
}

const dragProps = (sortable: SortableItemProps, dropMarker: DropMarker) => ({
  "data-drop-marker": dropMarker,
  "data-native-sortable-axis": sortable["data-native-sortable-axis"],
  draggable: sortable.draggable,
  onDragStart: sortable.onDragStart,
  onDragOver: sortable.onDragOver,
  onDrop: sortable.onDrop,
  onDragEnd: sortable.onDragEnd,
});

type EditProps = {
  /** Shows a name field instead of the row's button. */
  isEditing: boolean;
  onCommitEdit: (name: string) => void;
  onCancelEdit: () => void;
};

/**
 * A note: opens on click, and shows or hides its sub-notes from the chevron beside it, which
 * sits in the indent so the row's own button stays one control.
 */
export function NoteRow({
  note,
  depth,
  hasSubNotes,
  isOpen,
  onToggle,
  isActive,
  isSelected,
  animateEntry,
  sortable,
  dropMarker,
  onClick,
  isEditing,
  onCommitEdit,
  onCancelEdit,
}: EditProps & {
  note: NoteDocument;
  depth: number;
  hasSubNotes: boolean;
  isOpen: boolean;
  onToggle: () => void;
  isActive: boolean;
  isSelected: boolean;
  animateEntry: boolean;
  sortable: SortableItemProps;
  dropMarker: DropMarker;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const title = getNoteTitle(note);
  const rowProps = {
    style: noteIndent(depth),
    "data-selected": isSelected ? "true" : "false",
    "data-tree-selection-key": noteSelectionKey(note.id),
  };

  return (
    <TreeRowEntry fadeIn={animateEntry}>
      <div className="relative">
        {hasSubNotes ? (
          <button
            type="button"
            aria-label={isOpen ? `Hide sub-notes of ${title}` : `Show sub-notes of ${title}`}
            aria-expanded={isOpen}
            className="absolute top-1/2 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-(--app-muted) hover:bg-(--app-page-2) hover:text-(--app-text)"
            style={{ left: `${2 + 12 * depth}px` }}
            onClick={onToggle}
          >
            <Chevron isOpen={isOpen} />
          </button>
        ) : null}
        {isEditing ? (
          <SidebarRow asChild isActive={isActive} {...rowProps}>
            <div>
              <NoteRouteGlyph className="size-4 shrink-0" />
              <TreeNameInput
                label="Rename note"
                autoSelect
                initialValue={note.title}
                maxLength={MAX_NOTE_TITLE_LENGTH}
                onCommit={onCommitEdit}
                onCancel={onCancelEdit}
              />
            </div>
          </SidebarRow>
        ) : (
          <SidebarRow
            type="button"
            isActive={isActive || isSelected}
            onClick={onClick}
            aria-current={isActive ? "page" : undefined}
            aria-pressed={isSelected}
            className={cn(isSelected && !isActive && "bg-(--app-page-2)/55")}
            {...rowProps}
            {...dragProps(sortable, dropMarker)}
          >
            <NoteRouteGlyph className="size-4 shrink-0" />
            <span className="min-w-0 truncate" title={title}>
              {title}
            </span>
          </SidebarRow>
        )}
      </div>
    </TreeRowEntry>
  );
}

export function FolderRow({
  folder,
  depth,
  isOpen,
  isSelected,
  animateEntry,
  sortable,
  dropMarker,
  onClick,
  isEditing,
  onCommitEdit,
  onCancelEdit,
}: EditProps & {
  folder: NoteFolder;
  depth: 0 | 1;
  isOpen: boolean;
  isSelected: boolean;
  animateEntry: boolean;
  sortable: SortableItemProps;
  dropMarker: DropMarker;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const rowProps = {
    style: containerIndent(depth),
    "data-folder-id": folder.id,
    "data-selected": isSelected ? "true" : "false",
    "data-tree-selection-key": folderSelectionKey(folder.id),
  };
  const Icon = isOpen ? FolderOpenIcon : FolderIcon;

  return (
    <TreeRowEntry fadeIn={animateEntry}>
      {isEditing ? (
        <SidebarRow asChild isOpen={isOpen} isActive={isSelected} {...rowProps}>
          <div>
            <Chevron isOpen={isOpen} />
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <TreeNameInput
              label="Rename folder"
              autoSelect
              initialValue={folder.name}
              maxLength={MAX_FOLDER_NAME_LENGTH}
              onCommit={onCommitEdit}
              onCancel={onCancelEdit}
            />
          </div>
        </SidebarRow>
      ) : (
        <SidebarRow
          type="button"
          isOpen={isOpen}
          isActive={isSelected}
          className={cn("select-none", isSelected && "bg-(--app-page-2)/55 text-(--app-text)")}
          onClick={onClick}
          aria-expanded={isOpen}
          aria-pressed={isSelected}
          {...rowProps}
          {...dragProps(sortable, dropMarker)}
        >
          <Chevron isOpen={isOpen} />
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate" title={folder.name}>
            {folder.name}
          </span>
        </SidebarRow>
      )}
    </TreeRowEntry>
  );
}

/**
 * A project: opens and closes on click, takes dropped notes and folders, and moves among the
 * other projects. Projects are never selected; a right-click opens the project's own menu.
 */
export function ProjectRow({
  project,
  isOpen,
  isEmpty,
  animateEntry,
  sortable,
  dropMarker,
  onClick,
}: {
  project: NoteProject;
  isOpen: boolean;
  isEmpty: boolean;
  animateEntry: boolean;
  sortable: SortableItemProps;
  dropMarker: DropMarker;
  onClick: () => void;
}) {
  return (
    <TreeRowEntry fadeIn={animateEntry}>
      <SidebarRow
        type="button"
        isOpen={isOpen}
        className="select-none"
        style={containerIndent(0)}
        onClick={onClick}
        aria-expanded={isOpen}
        data-tree-selection-key={projectSelectionKey(project.id)}
        {...dragProps(sortable, dropMarker)}
      >
        <Chevron isOpen={isOpen} />
        <NoteProjectIcon icon={project.icon} />
        <span className="min-w-0 truncate font-medium" title={project.name}>
          {project.name}
        </span>
        {isEmpty ? (
          <span aria-hidden="true" className="ml-auto shrink-0 text-xs text-(--app-muted)/70">
            Empty
          </span>
        ) : null}
      </SidebarRow>
    </TreeRowEntry>
  );
}

/**
 * A place where dropping a note or folder moves it to the top level: the strip above the
 * top-level notes when projects show over them, the strip under them, and the empty space
 * under the whole list.
 */
export const RootDropZone = ({
  zoneProps,
  className = "h-4",
}: {
  zoneProps: ReturnType<SortableList["zoneProps"]>;
  className?: string;
}) => (
  <div
    className={cn("rounded-sm", className)}
    data-native-sortable-zone={zoneProps["data-native-sortable-zone"]}
    data-drop-marker={zoneProps["data-drop-marker"]}
    data-native-sortable-axis={zoneProps["data-native-sortable-axis"]}
    onDragOver={zoneProps.onDragOver}
    onDrop={zoneProps.onDrop}
  />
);

/** The name field shown where a new folder will appear. */
export const NewFolderRow = ({
  depth,
  animateEntry,
  onCommit,
  onCancel,
}: {
  depth: 0 | 1;
  animateEntry: boolean;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) => (
  <TreeRowEntry fadeIn={animateEntry}>
    <SidebarRow asChild isOpen style={containerIndent(depth)}>
      <div>
        <span className="size-3.5 shrink-0" />
        <FolderIcon className="size-4 shrink-0" aria-hidden="true" />
        <TreeNameInput
          label="Folder name"
          initialValue="New folder"
          autoSelect
          maxLength={MAX_FOLDER_NAME_LENGTH}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      </div>
    </SidebarRow>
  </TreeRowEntry>
);

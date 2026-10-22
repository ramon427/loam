import {
  ArrowUpDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  LinkIcon,
  EllipsisVerticalIcon,
  Trash2Icon,
} from "lucide-react";

import { cn } from "../ui/cn";
import type { NoteTableColumn } from "@loam/shared/notes/noteModel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/DropdownMenu";

const sortMenuLabel = (sortDirection?: "ASC" | "DESC") => {
  if (!sortDirection) return "Sort ascending";
  if (sortDirection === "ASC") return "Sort descending";
  return "Clear sort";
};

/** A column's header cell: its title, sort arrow, heading links, and column menu. */
export function TableColumnHeader({
  column,
  sortDirection,
  readOnly,
  selected,
  onSelect,
  onSort,
  onMove,
  onDelete,
  onDuplicate,
  onManageHeadings,
}: {
  column: NoteTableColumn;
  sortDirection?: "ASC" | "DESC";
  readOnly: boolean;
  selected: boolean;
  onSelect: () => void;
  onSort: () => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onManageHeadings: () => void;
}) {
  const headingConnectionCount = column.headingBlockIds?.length ?? 0;

  return (
    <div
      aria-label={`${column.title} column controls`}
      className={cn(
        "group/header flex size-full min-w-0 items-center gap-1",
        selected && "bg-(--app-accent)/10",
      )}
      onClick={onSelect}
      role="group"
    >
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-(--app-text)">
        {column.title}
      </span>
      {sortDirection ? (
        <span className="text-[9px] text-(--app-accent)">
          {sortDirection === "ASC" ? "↑" : "↓"}
        </span>
      ) : null}
      {headingConnectionCount > 0 ? (
        <button
          aria-label={`Manage ${headingConnectionCount} heading ${
            headingConnectionCount === 1 ? "connection" : "connections"
          } for ${column.title}`}
          className="inline-flex min-h-6 min-w-6 items-center justify-center gap-0.5 rounded px-1 text-[9px] font-semibold text-(--app-muted) hover:bg-(--app-page) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--focus-ring)"
          onClick={(event) => {
            event.stopPropagation();
            onManageHeadings();
          }}
          type="button"
        >
          <LinkIcon aria-hidden="true" className="size-3" />
          {headingConnectionCount}
        </button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`Column menu for ${column.title}`}
            className="rounded p-0.5 text-(--app-muted) opacity-0 hover:bg-(--app-page) group-hover/header:opacity-100 focus:opacity-100"
            onClick={(event) => event.stopPropagation()}
            type="button"
          >
            <EllipsisVerticalIcon className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{column.title}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={onSort}>
            <ArrowUpDownIcon className="size-4" />
            {sortMenuLabel(sortDirection)}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={readOnly} onSelect={() => onMove(-1)}>
            <ChevronLeftIcon className="size-4" /> Move left
          </DropdownMenuItem>
          <DropdownMenuItem disabled={readOnly} onSelect={() => onMove(1)}>
            <ChevronRightIcon className="size-4" /> Move right
          </DropdownMenuItem>
          <DropdownMenuItem disabled={readOnly} onSelect={onDuplicate}>
            <CopyIcon className="size-4" /> Duplicate column
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onManageHeadings}>
            <LinkIcon className="size-4" /> Manage headings
          </DropdownMenuItem>
          <DropdownMenuItem disabled={readOnly} onSelect={onDelete} variant="destructive">
            <Trash2Icon className="size-4" /> Delete column
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

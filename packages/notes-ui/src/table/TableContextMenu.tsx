import {
  ArrowDownAZIcon,
  ArrowDownIcon,
  ArrowDownToLineIcon,
  ArrowDownZAIcon,
  ArrowLeftToLineIcon,
  ArrowRightToLineIcon,
  ArrowUpIcon,
  ArrowUpToLineIcon,
  CopyPlusIcon,
  Settings2Icon,
  Trash2Icon,
} from "lucide-react";
import { useState, type MouseEvent, type ReactElement } from "react";

import type { NoteTable, NoteTableRow } from "@loam/shared/notes/noteModel";

import {
  ActionMenuContent,
  ActionMenuItem,
  isActionMenuTarget,
  leaveToNativeMenu,
} from "../action-menu/ActionMenu";
import { ContextMenu, ContextMenuSeparator, ContextMenuTrigger } from "../ui/ContextMenu";

import type { NoteTableRowAction } from "./tableCommands";

export type TableRowMenuAction = "insert-above" | "insert-below" | NoteTableRowAction;
export type TableColumnMenuAction =
  "insert-left" | "insert-right" | "sort-asc" | "sort-desc" | "settings" | "delete";

type MenuTarget = { kind: "row"; id: string } | { kind: "column"; id: string };

const ariaIndex = (element: Element | null, attribute: string) =>
  Number(element?.getAttribute(attribute) ?? Number.NaN);

/**
 * Which row or column header a right-click in the grid landed on. The grid numbers its rows
 * and columns from 1 (`aria-rowindex`, `aria-colindex`), with the header row first and the row
 * number column first.
 */
const findMenuTarget = (
  element: Element,
  table: NoteTable,
  visibleRows: readonly NoteTableRow[],
): MenuTarget | null => {
  const header = element.closest('[role="columnheader"]');
  if (header) {
    const column = table.columns[ariaIndex(header, "aria-colindex") - 2];
    return column ? { kind: "column", id: column.id } : null;
  }
  const row = visibleRows[ariaIndex(element.closest('[role="row"]'), "aria-rowindex") - 2];
  return row ? { kind: "row", id: row.id } : null;
};

/**
 * The right-click menu of a table's grid: row actions on a row, column actions on a column
 * header. A read-only table offers only sorting, which changes the view and not the table.
 */
export function TableContextMenu({
  table,
  visibleRows,
  readOnly,
  isReordered,
  onOpenRowMenu,
  onRowAction,
  onColumnAction,
  children,
}: {
  table: NoteTable;
  /** The rows in the order the grid shows them. */
  visibleRows: readonly NoteTableRow[];
  readOnly: boolean;
  /** Whether a filter or sort changes the order shown, which moving rows does not follow. */
  isReordered: boolean;
  onOpenRowMenu: (rowId: string) => void;
  onRowAction: (rowId: string, action: TableRowMenuAction) => void;
  onColumnAction: (columnId: string, action: TableColumnMenuAction) => void;
  /** The element around the grid, which takes the right-clicks. */
  children: ReactElement;
}) {
  const [target, setTarget] = useState<MenuTarget | null>(null);

  const handleContextMenuCapture = (event: MouseEvent) => {
    const next =
      isActionMenuTarget(event) && event.target instanceof Element
        ? findMenuTarget(event.target, table, visibleRows)
        : null;
    if (!next || (next.kind === "row" && readOnly)) {
      leaveToNativeMenu(event);
      return;
    }
    setTarget(next);
    if (next.kind === "row") onOpenRowMenu(next.id);
  };

  const rowIndex =
    target?.kind === "row" ? table.rows.findIndex((row) => row.id === target.id) : -1;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenuCapture={handleContextMenuCapture}>
        {children}
      </ContextMenuTrigger>
      <ActionMenuContent aria-label={target?.kind === "column" ? "Column actions" : "Row actions"}>
        {target?.kind === "row" ? (
          <>
            <ActionMenuItem
              icon={<ArrowUpToLineIcon aria-hidden="true" />}
              onSelect={() => onRowAction(target.id, "insert-above")}
            >
              Insert row above
            </ActionMenuItem>
            <ActionMenuItem
              icon={<ArrowDownToLineIcon aria-hidden="true" />}
              onSelect={() => onRowAction(target.id, "insert-below")}
            >
              Insert row below
            </ActionMenuItem>
            <ActionMenuItem
              icon={<CopyPlusIcon aria-hidden="true" />}
              onSelect={() => onRowAction(target.id, "duplicate")}
            >
              Duplicate row
            </ActionMenuItem>
            <ActionMenuItem
              disabled={isReordered || rowIndex <= 0}
              icon={<ArrowUpIcon aria-hidden="true" />}
              onSelect={() => onRowAction(target.id, "up")}
            >
              Move up
            </ActionMenuItem>
            <ActionMenuItem
              disabled={isReordered || rowIndex < 0 || rowIndex >= table.rows.length - 1}
              icon={<ArrowDownIcon aria-hidden="true" />}
              onSelect={() => onRowAction(target.id, "down")}
            >
              Move down
            </ActionMenuItem>
            <ContextMenuSeparator />
            <ActionMenuItem
              destructive
              icon={<Trash2Icon aria-hidden="true" />}
              onSelect={() => onRowAction(target.id, "delete")}
            >
              Delete row
            </ActionMenuItem>
          </>
        ) : null}
        {target?.kind === "column" ? (
          <>
            {readOnly ? null : (
              <>
                <ActionMenuItem
                  icon={<ArrowLeftToLineIcon aria-hidden="true" />}
                  onSelect={() => onColumnAction(target.id, "insert-left")}
                >
                  Insert column left
                </ActionMenuItem>
                <ActionMenuItem
                  icon={<ArrowRightToLineIcon aria-hidden="true" />}
                  onSelect={() => onColumnAction(target.id, "insert-right")}
                >
                  Insert column right
                </ActionMenuItem>
              </>
            )}
            <ActionMenuItem
              icon={<ArrowDownAZIcon aria-hidden="true" />}
              onSelect={() => onColumnAction(target.id, "sort-asc")}
            >
              Sort A→Z
            </ActionMenuItem>
            <ActionMenuItem
              icon={<ArrowDownZAIcon aria-hidden="true" />}
              onSelect={() => onColumnAction(target.id, "sort-desc")}
            >
              Sort Z→A
            </ActionMenuItem>
            {readOnly ? null : (
              <>
                <ActionMenuItem
                  icon={<Settings2Icon aria-hidden="true" />}
                  onSelect={() => onColumnAction(target.id, "settings")}
                >
                  Column settings…
                </ActionMenuItem>
                <ContextMenuSeparator />
                {/* A table keeps at least one column. */}
                <ActionMenuItem
                  destructive
                  disabled={table.columns.length <= 1}
                  icon={<Trash2Icon aria-hidden="true" />}
                  onSelect={() => onColumnAction(target.id, "delete")}
                >
                  Delete column
                </ActionMenuItem>
              </>
            )}
          </>
        ) : null}
      </ActionMenuContent>
    </ContextMenu>
  );
}

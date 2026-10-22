import "react-data-grid/lib/styles.css";

import { LinkIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { DataGrid, type Column, type DataGridHandle, type SortColumn } from "react-data-grid";

import type { NoteHeadingConnectionOption } from "../editor/noteHeadingConnections";
import { HeadingConnectionManager } from "../editor/HeadingConnectionManager";
import type { TabHistoryCommands } from "../note/useTypedTabHistory";
import type { NoteTab, NoteTable, NoteTableRow } from "@loam/shared/notes/noteModel";
import { Button } from "../ui/Button";
import { SearchField } from "../ui/SearchField";
import { createUuid } from "@loam/shared/utils/uuid";

import styles from "./noteTable.module.css";
import {
  headingCountLabel,
  noteTableCellLabel,
  noteTableCellText,
  parseNoteTableCellText,
} from "./noteTable";
import { TableCellEditor, type TableGridRow } from "./TableCellEditor";
import { TableColumnHeader } from "./TableColumnHeader";
import { TableColumnSettings } from "./TableColumnSettings";
import {
  TableContextMenu,
  type TableColumnMenuAction,
  type TableRowMenuAction,
} from "./TableContextMenu";
import {
  addNoteTableColumn,
  addNoteTableRow,
  changeNoteTableRow,
  deleteNoteTableColumn,
  duplicateNoteTableColumn,
  moveNoteTableColumn,
  replaceNoteTableCells,
  shiftNoteTableColumn,
  updateNoteTableColumn,
  visibleNoteTableRows,
  type NoteTableRowAction,
  type NoteTableSort,
} from "./tableCommands";
import { TableRowActions } from "./TableRowActions";
import { useTableDraft } from "./useTableDraft";

/** The column or row of a table tab that is selected, for its settings and heading links. */
export type NoteTableSelection = {
  tabId: string;
  kind: "column" | "row";
  id: string;
};

export type NoteTablePanelProps = {
  tab: NoteTab;
  table: NoteTable;
  selectedTarget: NoteTableSelection | null;
  readOnly: boolean;
  onSelectTarget: (target: NoteTableSelection | null) => void;
  onUpdateTable: (table: NoteTable) => void;
  headingOptions: readonly NoteHeadingConnectionOption[];
  onToggleHeadingConnection: (target: NoteTableSelection, headingBlockId: string) => void;
  onOpenHeading: (headingBlockId: string) => void;
  historyBridgeRef?: MutableRefObject<TabHistoryCommands | null>;
};

const ROW_NUMBER_KEY = "__rowNumber";
const ROW_HEIGHT = 34;

const toGridRow = (row: NoteTableRow): TableGridRow => ({ __rowId: row.id, ...row.cells });

/** A table tab: a toolbar, the editable grid, and settings for the selected column. */
export function NoteTablePanel({
  tab,
  table: storedTable,
  selectedTarget,
  readOnly,
  onSelectTarget,
  onUpdateTable,
  headingOptions,
  onToggleHeadingConnection,
  onOpenHeading,
  historyBridgeRef,
}: NoteTablePanelProps) {
  const { table, commit } = useTableDraft({
    tabId: tab.id,
    table: storedTable,
    onUpdateTable,
    historyBridgeRef,
  });
  const [filterValue, setFilterValue] = useState("");
  const [sortColumns, setSortColumns] = useState<readonly SortColumn[]>([]);
  const [headingTarget, setHeadingTarget] = useState<NoteTableSelection | null>(null);
  const gridRef = useRef<DataGridHandle>(null);
  const columnNameRef = useRef<HTMLInputElement>(null);

  const sort = useMemo<NoteTableSort | null>(
    () =>
      sortColumns[0]
        ? { columnId: sortColumns[0].columnKey, direction: sortColumns[0].direction }
        : null,
    [sortColumns],
  );
  const isReordered = Boolean(filterValue.trim() || sort);
  const visibleRows = useMemo(
    () => visibleNoteTableRows(table, filterValue, sort),
    [table, filterValue, sort],
  );
  const gridRows = useMemo(() => visibleRows.map(toGridRow), [visibleRows]);

  const target = selectedTarget?.tabId === tab.id ? selectedTarget : null;
  const selectedRow =
    target?.kind === "row" ? table.rows.find((row) => row.id === target.id) : undefined;
  const selectedColumn =
    target?.kind === "column" ? table.columns.find((column) => column.id === target.id) : undefined;
  const select = (kind: NoteTableSelection["kind"], id: string) =>
    onSelectTarget({ tabId: tab.id, kind, id });
  const openHeadings = (kind: NoteTableSelection["kind"], id: string) => {
    const next = { tabId: tab.id, kind, id };
    setHeadingTarget(next);
    onSelectTarget(next);
  };

  // Bring the selected row or column into view; a row the filter hides is deselected.
  useEffect(() => {
    if (!target) return;
    let cell: { idx: number; rowIdx?: number };
    if (target.kind === "row") {
      if (!table.rows.some((row) => row.id === target.id)) return;
      const rowIdx = visibleRows.findIndex((row) => row.id === target.id);
      if (rowIdx < 0) {
        onSelectTarget(null);
        return;
      }
      cell = { idx: 1, rowIdx };
    } else {
      const columnIndex = table.columns.findIndex((column) => column.id === target.id);
      if (columnIndex < 0) return;
      cell = { idx: columnIndex + 1 };
    }
    const frame = requestAnimationFrame(() => gridRef.current?.scrollToCell(cell));
    return () => cancelAnimationFrame(frame);
  }, [onSelectTarget, table.columns, table.rows, target, visibleRows]);

  const edit = (next: NoteTable | null, group?: string) => {
    if (!readOnly) commit(next, group);
  };

  const toggleSort = (columnId: string) =>
    setSortColumns(([active]) => {
      if (active?.columnKey !== columnId) return [{ columnKey: columnId, direction: "ASC" }];
      return active.direction === "ASC" ? [{ columnKey: columnId, direction: "DESC" }] : [];
    });

  const rowNumberColumn: Column<TableGridRow> = {
    key: ROW_NUMBER_KEY,
    name: "",
    frozen: true,
    width: 42,
    minWidth: 42,
    maxWidth: 42,
    cellClass: styles.rowNumber,
    renderCell: ({ row, rowIdx }) => {
      const count =
        table.rows.find((candidate) => candidate.id === row.__rowId)?.headingBlockIds?.length ?? 0;
      return (
        <button
          aria-label={`Manage heading connections for row ${rowIdx + 1}${headingCountLabel(count)}`}
          className="flex size-full items-center justify-center gap-0.5 rounded-sm text-[10px] text-(--app-muted) hover:bg-(--app-page-2) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--focus-ring)"
          onClick={() => openHeadings("row", row.__rowId)}
          type="button"
        >
          <span>{rowIdx + 1}</span>
          {count > 0 ? (
            <span className="inline-flex items-center gap-px font-semibold">
              <LinkIcon aria-hidden="true" className="size-2.5" />
              {count}
            </span>
          ) : null}
        </button>
      );
    },
  };
  const columns: Column<TableGridRow>[] = [
    rowNumberColumn,
    ...table.columns.map((definition): Column<TableGridRow> => ({
      key: definition.id,
      name: definition.title,
      width: definition.width ?? 180,
      minWidth: 72,
      maxWidth: 480,
      resizable: !readOnly,
      draggable: !readOnly,
      sortable: true,
      editable: !readOnly,
      renderHeaderCell: ({ sortDirection }) => (
        <TableColumnHeader
          column={definition}
          sortDirection={sortDirection}
          readOnly={readOnly}
          selected={selectedColumn?.id === definition.id}
          onSelect={() => select("column", definition.id)}
          onSort={() => toggleSort(definition.id)}
          onMove={(direction) => edit(shiftNoteTableColumn(table, definition.id, direction))}
          onDelete={() => deleteColumn(definition.id)}
          onDuplicate={() => {
            const copyId = createUuid();
            const duplicated = duplicateNoteTableColumn(table, definition.id, copyId);
            if (!duplicated || readOnly) return;
            edit(duplicated);
            select("column", copyId);
          }}
          onManageHeadings={() => openHeadings("column", definition.id)}
        />
      ),
      renderCell: ({ row }) => noteTableCellLabel(definition, row[definition.id]),
      renderEditCell: (props) => <TableCellEditor {...props} definition={definition} />,
    })),
  ];

  const applyGridRows = (nextRows: TableGridRow[]) => {
    const shown = new Set(gridRows);
    const edited = new Map(
      nextRows.filter((row) => !shown.has(row)).map((row) => [row.__rowId, row]),
    );
    if (edited.size > 0) edit(replaceNoteTableCells(table, edited));
  };

  const addRow = (index?: number) => {
    const added = addNoteTableRow(table, index);
    if (!added || readOnly) return;
    edit(added.table);
    select("row", added.row.id);
  };

  const addColumn = (index?: number) => {
    const added = addNoteTableColumn(table, index);
    if (!added || readOnly) return;
    edit(added.table);
    select("column", added.column.id);
  };

  const deleteColumn = (columnId: string) => {
    edit(deleteNoteTableColumn(table, columnId));
    onSelectTarget(null);
  };

  const changeRow = (rowId: string, action: NoteTableRowAction) => {
    edit(changeNoteTableRow(table, rowId, action));
    if (action === "delete") onSelectTarget(null);
  };

  const changeSelectedRow = (action: NoteTableRowAction) => {
    if (selectedRow) changeRow(selectedRow.id, action);
  };

  const runRowMenuAction = (rowId: string, action: TableRowMenuAction) => {
    const index = table.rows.findIndex((row) => row.id === rowId);
    if (action === "insert-above") addRow(index);
    else if (action === "insert-below") addRow(index + 1);
    else changeRow(rowId, action);
  };

  const runColumnMenuAction = (columnId: string, action: TableColumnMenuAction) => {
    const index = table.columns.findIndex((column) => column.id === columnId);
    if (action === "insert-left") addColumn(index);
    if (action === "insert-right") addColumn(index + 1);
    if (action === "sort-asc") setSortColumns([{ columnKey: columnId, direction: "ASC" }]);
    if (action === "sort-desc") setSortColumns([{ columnKey: columnId, direction: "DESC" }]);
    if (action === "delete") deleteColumn(columnId);
    if (action === "settings") {
      select("column", columnId);
      // The settings strip renders with the selection; focus its name field once it has.
      requestAnimationFrame(() => columnNameRef.current?.focus());
    }
  };

  const headingTargetRow =
    headingTarget?.kind === "row" ? table.rows.find((row) => row.id === headingTarget.id) : null;
  const headingTargetColumn =
    headingTarget?.kind === "column"
      ? table.columns.find((column) => column.id === headingTarget.id)
      : null;
  const firstColumn = table.columns[0];

  return (
    <div className="flex min-h-[34rem] w-full flex-col overflow-hidden bg-(--app-surface)">
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 border-b border-(--app-border)/70 px-2 py-1.5">
        <SearchField
          label="Filter table"
          className="h-7 min-w-40 flex-1 sm:max-w-64"
          onChange={setFilterValue}
          placeholder="Filter table"
          value={filterValue}
        />
        <Button disabled={readOnly} onClick={() => addRow()} size="sm" variant="ghost-muted">
          <PlusIcon className="size-4" /> Row
        </Button>
        <Button disabled={readOnly} onClick={() => addColumn()} size="sm" variant="ghost-muted">
          <PlusIcon className="size-4" /> Column
        </Button>
        {selectedRow ? (
          <TableRowActions
            row={selectedRow}
            readOnly={readOnly}
            isReordered={isReordered}
            onAction={changeSelectedRow}
            onManageHeadings={() => openHeadings("row", selectedRow.id)}
          />
        ) : null}
      </div>

      <TableContextMenu
        isReordered={isReordered}
        onColumnAction={runColumnMenuAction}
        onOpenRowMenu={(rowId) => select("row", rowId)}
        onRowAction={runRowMenuAction}
        readOnly={readOnly}
        table={table}
        visibleRows={visibleRows}
      >
        <div className="min-h-0 flex-1 overflow-hidden bg-(--app-page)">
          <DataGrid<TableGridRow>
            aria-label={`${tab.title} table`}
            className={styles.grid}
            columns={columns}
            defaultColumnOptions={{ resizable: !readOnly }}
            headerRowHeight={ROW_HEIGHT}
            onCellClick={({ row, column }) => {
              if (column.key !== ROW_NUMBER_KEY) select("row", row.__rowId);
            }}
            onCellCopy={({ row, column }, event) => {
              const definition = table.columns.find((candidate) => candidate.id === column.key);
              if (definition) {
                event.clipboardData.setData(
                  "text/plain",
                  noteTableCellText(definition, row[column.key]),
                );
              }
            }}
            onCellPaste={({ row, column }, event) => {
              const definition = table.columns.find((candidate) => candidate.id === column.key);
              if (!definition || readOnly) return row;
              const text = event.clipboardData.getData("text/plain");
              return { ...row, [column.key]: parseNoteTableCellText(definition, text) };
            }}
            onColumnResize={(column, width) => {
              if (column.key === ROW_NUMBER_KEY) return;
              edit(
                updateNoteTableColumn(table, column.key, { width: Math.round(width) }),
                `width:${column.key}`,
              );
            }}
            onColumnsReorder={(sourceKey, targetKey) =>
              edit(moveNoteTableColumn(table, sourceKey, targetKey))
            }
            onRowsChange={applyGridRows}
            onSortColumnsChange={(next) => setSortColumns(next.slice(-1))}
            ref={gridRef}
            rowClass={(row) =>
              target?.kind === "row" && target.id === row.__rowId
                ? "bg-(--app-accent)/10"
                : undefined
            }
            rowHeight={ROW_HEIGHT}
            rowKeyGetter={(row) => row.__rowId}
            rows={gridRows}
            sortColumns={sortColumns}
            style={{ blockSize: 560 }}
          />
        </div>
      </TableContextMenu>

      {selectedColumn ? (
        <TableColumnSettings
          key={selectedColumn.id}
          column={selectedColumn}
          nameRef={columnNameRef}
          readOnly={readOnly}
          onChange={(patch, group) =>
            edit(updateNoteTableColumn(table, selectedColumn.id, patch), group)
          }
          onManageHeadings={() => openHeadings("column", selectedColumn.id)}
        />
      ) : null}

      <HeadingConnectionManager
        headingOptions={headingOptions}
        onOpenChange={(open) => {
          if (!open) setHeadingTarget(null);
        }}
        onOpenHeading={onOpenHeading}
        onToggleHeading={(headingBlockId) => {
          if (headingTarget) onToggleHeadingConnection(headingTarget, headingBlockId);
        }}
        open={Boolean(headingTarget)}
        readOnly={readOnly}
        selectedHeadingBlockIds={(headingTargetRow ?? headingTargetColumn)?.headingBlockIds ?? []}
        targetLabel={
          headingTarget?.kind === "row"
            ? (firstColumn && headingTargetRow
                ? noteTableCellText(firstColumn, headingTargetRow.cells[firstColumn.id])
                : "") || "Table row"
            : headingTargetColumn?.title || "Table column"
        }
      />
    </div>
  );
}

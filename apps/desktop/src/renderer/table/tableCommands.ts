import type {
  NoteTable,
  NoteTableCellValue,
  NoteTableColumn,
  NoteTableRow,
} from "@loam/shared/notes/noteModel";
import { incrementDuplicateName } from "../lib/duplicateName";
import { createUuid } from "@loam/shared/utils/uuid";

import {
  compareNoteTableCells,
  createNoteTableColumn,
  createNoteTableRow,
  normalizeNoteTable,
  noteTableCellText,
} from "./noteTable";

/**
 * Edits a table tab makes, as pure functions from one table to the next. A command that
 * cannot apply (a limit, a missing id, nowhere to move) returns null.
 */

const MAX_COLUMNS = 80;
const MAX_ROWS = 2_000;

export type NoteTableSort = { columnId: string; direction: "ASC" | "DESC" };

/** Numbers columns and rows by their place in the lists, and cleans the result. */
export const positionNoteTable = (table: NoteTable): NoteTable => {
  const positioned = {
    ...table,
    columns: table.columns.map((column, index) => ({ ...column, position: index })),
    rows: table.rows.map((row, index) => ({ ...row, position: index })),
  };
  return normalizeNoteTable(positioned) ?? positioned;
};

/** The rows on screen: those with a cell containing `query`, in the chosen order. */
export const visibleNoteTableRows = (
  table: NoteTable,
  query: string,
  sort: NoteTableSort | null,
): NoteTableRow[] => {
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? table.rows.filter((row) =>
        table.columns.some((column) =>
          noteTableCellText(column, row.cells[column.id]).toLowerCase().includes(needle),
        ),
      )
    : table.rows;
  const sortColumn = table.columns.find((column) => column.id === sort?.columnId);
  if (!sort || !sortColumn) return filtered;
  return [...filtered].sort((left, right) => {
    const result = compareNoteTableCells(
      sortColumn,
      left.cells[sortColumn.id],
      right.cells[sortColumn.id],
    );
    return sort.direction === "ASC" ? result : -result;
  });
};

/** Writes edited cell values back into their rows, keeping every column of each row. */
export const replaceNoteTableCells = (
  table: NoteTable,
  edited: ReadonlyMap<string, Readonly<Record<string, NoteTableCellValue | undefined>>>,
): NoteTable => ({
  ...table,
  rows: table.rows.map((row) => {
    const values = edited.get(row.id);
    if (!values) return row;
    return {
      ...row,
      cells: Object.fromEntries(
        table.columns.map((column) => [column.id, values[column.id] ?? null]),
      ),
    };
  }),
});

export const updateNoteTableColumn = (
  table: NoteTable,
  columnId: string,
  patch: Partial<NoteTableColumn>,
): NoteTable => ({
  ...table,
  columns: table.columns.map((column) =>
    column.id === columnId ? { ...column, ...patch } : column,
  ),
});

/** Moves a column into the place of another, as dragging a header does. */
export const moveNoteTableColumn = (
  table: NoteTable,
  sourceId: string,
  targetId: string,
): NoteTable | null => {
  const sourceIndex = table.columns.findIndex((column) => column.id === sourceId);
  const targetIndex = table.columns.findIndex((column) => column.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return null;
  const columns = [...table.columns];
  const [moved] = columns.splice(sourceIndex, 1);
  columns.splice(targetIndex, 0, moved!);
  return { ...table, columns };
};

/** Moves a column one place left (-1) or right (1). */
export const shiftNoteTableColumn = (table: NoteTable, columnId: string, direction: -1 | 1) => {
  const index = table.columns.findIndex((column) => column.id === columnId);
  const target = index < 0 ? undefined : table.columns[index + direction];
  return target ? moveNoteTableColumn(table, columnId, target.id) : null;
};

/** Adds an empty column at `index` (by default after the last one). */
export const addNoteTableColumn = (table: NoteTable, index = table.columns.length) => {
  if (table.columns.length >= MAX_COLUMNS) return null;
  const column = createNoteTableColumn(`Column ${table.columns.length + 1}`, table.columns.length);
  const columns = [...table.columns];
  columns.splice(index, 0, column);
  return {
    column,
    table: {
      columns,
      rows: table.rows.map((row) => ({ ...row, cells: { ...row.cells, [column.id]: "" } })),
    },
  };
};

/** Inserts a copy of a column, with its values, right after it. */
export const duplicateNoteTableColumn = (
  table: NoteTable,
  columnId: string,
  id = createUuid(),
): NoteTable | null => {
  const sourceIndex = table.columns.findIndex((column) => column.id === columnId);
  const source = table.columns[sourceIndex];
  if (!source || table.columns.length >= MAX_COLUMNS) return null;
  const duplicate: NoteTableColumn = {
    ...source,
    id,
    title: incrementDuplicateName(source.title),
    options: source.options?.map((option) => ({ ...option })),
    headingBlockIds: source.headingBlockIds ? [...source.headingBlockIds] : undefined,
  };
  const columns = [...table.columns];
  columns.splice(sourceIndex + 1, 0, duplicate);
  return {
    columns,
    rows: table.rows.map((row) => ({
      ...row,
      cells: { ...row.cells, [id]: row.cells[source.id] ?? null },
    })),
  };
};

/** Removes a column and its values; the last column stays. */
export const deleteNoteTableColumn = (table: NoteTable, columnId: string): NoteTable | null => {
  if (table.columns.length <= 1 || !table.columns.some((column) => column.id === columnId)) {
    return null;
  }
  return {
    columns: table.columns.filter((column) => column.id !== columnId),
    rows: table.rows.map((row) => {
      const cells = { ...row.cells };
      delete cells[columnId];
      return { ...row, cells };
    }),
  };
};

/** Adds an empty row at `index` in the stored order (by default after the last one). */
export const addNoteTableRow = (table: NoteTable, index = table.rows.length) => {
  if (table.rows.length >= MAX_ROWS) return null;
  const row = createNoteTableRow(table.columns, table.rows.length);
  const rows = [...table.rows];
  rows.splice(index, 0, row);
  return { row, table: { ...table, rows } };
};

export const duplicateNoteTableRow = (row: NoteTableRow, id = createUuid()): NoteTableRow => ({
  ...row,
  id,
  cells: { ...row.cells },
  headingBlockIds: row.headingBlockIds ? [...row.headingBlockIds] : undefined,
});

export type NoteTableRowAction = "up" | "down" | "duplicate" | "delete";

/** Moves, copies, or removes one row. Moving follows the stored order. */
export const changeNoteTableRow = (
  table: NoteTable,
  rowId: string,
  action: NoteTableRowAction,
): NoteTable | null => {
  const index = table.rows.findIndex((row) => row.id === rowId);
  const row = table.rows[index];
  if (!row) return null;
  const rows = [...table.rows];
  if (action === "delete") rows.splice(index, 1);
  if (action === "duplicate") rows.splice(index + 1, 0, duplicateNoteTableRow(row));
  if (action === "up" || action === "down") {
    const target = action === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= rows.length) return null;
    rows[index] = rows[target]!;
    rows[target] = row;
  }
  return { ...table, rows };
};

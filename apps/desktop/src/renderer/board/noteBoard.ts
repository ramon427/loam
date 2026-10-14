import type { NoteTable, NoteTableColumn, NoteTableRow } from "@loam/shared/notes/noteModel";
import { createUuid } from "@loam/shared/utils/uuid";

import { createNoteTableColumn, createNoteTableRow, noteTableCellText } from "../table/noteTable";

/*
 * A board tab is a table shown as cards: each row is a card, in the column of
 * its choice in the table's group column, a select column. The table is the
 * same one a table tab holds, so a tab turns between the two and keeps it.
 */

const DEFAULT_GROUPS = ["To do", "Doing", "Done"];

/** The id of the group cards with no choice go in. */
const UNGROUPED = "";

export type BoardGroup = { id: string; label: string; rows: NoteTableRow[] };

/** The column a board groups by, if the table has it. */
const groupColumnOf = (table: NoteTable): NoteTableColumn | undefined =>
  table.columns.find((column) => column.id === table.groupColumnId && column.type === "select");

/**
 * `table` ready for a board: grouped by its group column, else by its first
 * select column, else by a new "Status" column with to do, doing and done.
 */
export const withBoardGroups = (table: NoteTable): NoteTable => {
  if (groupColumnOf(table)) return table;
  const select = table.columns.find((column) => column.type === "select");
  if (select) return { ...table, groupColumnId: select.id };
  // A table may have a text column called Status already.
  const name = table.columns.some((column) => column.title === "Status") ? "Stage" : "Status";
  const status: NoteTableColumn = {
    ...createNoteTableColumn(name, table.columns.length, "select"),
    options: DEFAULT_GROUPS.map((label) => ({ id: createUuid(), label })),
  };
  return {
    ...table,
    columns: [...table.columns, status],
    rows: table.rows.map((row) => ({
      ...row,
      cells: { ...row.cells, [status.id]: status.options![0]!.id },
    })),
    groupColumnId: status.id,
  };
};

/** A new board: no cards yet, in to do, doing and done, each with a title and notes. */
export const createNoteBoard = (): NoteTable =>
  withBoardGroups({
    columns: [createNoteTableColumn("Title", 0), createNoteTableColumn("Notes", 1)],
    rows: [],
  });

/** The column a card shows as its title: the first one the board doesn't group by. */
export const titleColumnOf = (table: NoteTable) =>
  table.columns.find((column) => column.id !== table.groupColumnId);

/** The board's columns, one per choice, then the cards without one if there are any. */
export const boardGroups = (table: NoteTable): BoardGroup[] => {
  const column = groupColumnOf(table);
  const options = column?.options ?? [];
  const known = new Set(options.map((option) => option.id));
  const groupOf = (row: NoteTableRow) => {
    const value = column ? row.cells[column.id] : undefined;
    return typeof value === "string" && known.has(value) ? value : UNGROUPED;
  };
  const groups = options.map((option) => ({
    id: option.id,
    label: option.label,
    rows: table.rows.filter((row) => groupOf(row) === option.id),
  }));
  const ungrouped = table.rows.filter((row) => groupOf(row) === UNGROUPED);
  return ungrouped.length || groups.length === 0
    ? [...groups, { id: UNGROUPED, label: "No group", rows: ungrouped }]
    : groups;
};

/** The other filled cells of a card, as label and text, for its face. */
export const cardFields = (table: NoteTable, row: NoteTableRow) => {
  const title = titleColumnOf(table);
  return table.columns.flatMap((column) => {
    if (column.id === title?.id || column.id === table.groupColumnId) return [];
    const text = noteTableCellText(column, row.cells[column.id]).trim();
    return text ? [{ id: column.id, label: column.title, text }] : [];
  });
};

/**
 * Puts a card in `groupId`, before `beforeRowId` when given, otherwise after
 * the group's last card. Null when nothing changes.
 */
export const moveCard = (
  table: NoteTable,
  rowId: string,
  groupId: string,
  beforeRowId?: string,
): NoteTable | null => {
  const column = groupColumnOf(table);
  const row = table.rows.find((candidate) => candidate.id === rowId);
  if (!column || !row || rowId === beforeRowId) return null;
  const moved = { ...row, cells: { ...row.cells, [column.id]: groupId } };
  const rest = table.rows.filter((candidate) => candidate.id !== rowId);
  let index = beforeRowId ? rest.findIndex((candidate) => candidate.id === beforeRowId) : -1;
  if (index < 0) {
    const lastInGroup = rest.findLastIndex(
      (candidate) => (candidate.cells[column.id] ?? UNGROUPED) === groupId,
    );
    index = lastInGroup < 0 ? rest.length : lastInGroup + 1;
  }
  const rows = [...rest.slice(0, index), moved, ...rest.slice(index)];
  const unchanged =
    row.cells[column.id] === groupId &&
    rows.every((candidate, at) => candidate.id === table.rows[at]!.id);
  return unchanged ? null : { ...table, rows };
};

/** A new card titled `title` at the end of `groupId`. */
export const addCard = (table: NoteTable, groupId: string, title: string) => {
  const column = groupColumnOf(table);
  const titleColumn = titleColumnOf(table);
  const row = createNoteTableRow(table.columns, table.rows.length);
  if (titleColumn) row.cells[titleColumn.id] = title;
  if (column) row.cells[column.id] = groupId;
  return (
    moveCard({ ...table, rows: [...table.rows, row] }, row.id, groupId) ?? {
      ...table,
      rows: [...table.rows, row],
    }
  );
};

/** A new choice in the group column, which shows as a new column of cards. */
export const addGroup = (table: NoteTable, label: string): NoteTable => {
  if (!label.trim()) return table;
  if (!groupColumnOf(table)) table = withBoardGroups(table);
  const column = groupColumnOf(table)!;
  const option = { id: createUuid(), label: label.trim() };
  return {
    ...table,
    columns: table.columns.map((candidate) =>
      candidate.id === column.id
        ? { ...candidate, options: [...(candidate.options ?? []), option] }
        : candidate,
    ),
  };
};

export const renameCard = (table: NoteTable, rowId: string, title: string): NoteTable => {
  const titleColumn = titleColumnOf(table);
  if (!titleColumn) return table;
  return {
    ...table,
    rows: table.rows.map((row) =>
      row.id === rowId ? { ...row, cells: { ...row.cells, [titleColumn.id]: title } } : row,
    ),
  };
};

export const deleteCard = (table: NoteTable, rowId: string): NoteTable => ({
  ...table,
  rows: table.rows.filter((row) => row.id !== rowId),
});

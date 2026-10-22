import type { NoteDocument } from "../workspace/types";
import type {
  NoteTable,
  NoteTableCellValue,
  NoteTableColumn,
  NoteTableColumnType,
  NoteTableRow,
} from "@loam/shared/notes/noteModel";
import { normalizeNoteHeadingBlockIds } from "@loam/shared/notes/headingConnections";
import { createUuid } from "@loam/shared/utils/uuid";
import { clamp } from "../lib/clamp";

/** The data model of a table tab: creating, normalizing, and reading cells. */

export type NoteTableSelectOption = NonNullable<NoteTableColumn["options"]>[number];

const defaultColumnTitles = ["Topic", "Status", "Notes"];

export const createNoteTableColumn = (
  title: string,
  index = 0,
  type: NoteTableColumnType = "text",
): NoteTableColumn => ({
  id: createUuid(),
  title,
  type,
  width: index === 2 ? 260 : 180,
  position: index,
});

export const createNoteTableRow = (
  columns: readonly NoteTableColumn[],
  index = 0,
): NoteTableRow => ({
  id: createUuid(),
  position: index,
  cells: Object.fromEntries(columns.map((column) => [column.id, ""])),
});

/** A new table tab: three columns and one row titled after the note. */
export const createNoteTable = (note: Pick<NoteDocument, "title">): NoteTable => {
  const columns = defaultColumnTitles.map((title, index) => createNoteTableColumn(title, index));
  const row = createNoteTableRow(columns, 0);
  row.cells[columns[0]!.id] = note.title.trim() || "First example";
  return { columns, rows: [row] };
};

const isNoteTableCellValue = (value: unknown): value is NoteTableCellValue =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";

/** Cleans stored or edited table data; null when there is no usable table. */
export const normalizeNoteTable = (table?: NoteTable | null): NoteTable | null => {
  if (!table || !Array.isArray(table.columns) || table.columns.length === 0) {
    return null;
  }

  const columns = table.columns.map((column, index) => {
    const headingBlockIds = normalizeNoteHeadingBlockIds(column.headingBlockIds);
    return {
      id: column.id,
      title: column.title.trim() || `Column ${index + 1}`,
      type: column.type ?? "text",
      width:
        typeof column.width === "number" ? clamp(Math.floor(column.width), 72, 480) : undefined,
      position: column.position ?? index,
      options:
        column.type === "select"
          ? (column.options ?? [])
              .map((option) => ({ id: option.id, label: option.label.trim() }))
              .filter((option) => option.label.length > 0)
          : undefined,
      ...(headingBlockIds ? { headingBlockIds } : {}),
    };
  });
  const columnIds = new Set(columns.map((column) => column.id));

  const rows = (Array.isArray(table.rows) ? table.rows : []).map((row, index) => {
    const headingBlockIds = normalizeNoteHeadingBlockIds(row.headingBlockIds);
    return {
      id: row.id,
      position: row.position ?? index,
      cells: Object.fromEntries(
        Object.entries(row.cells ?? {}).filter(
          ([columnId, value]) => columnIds.has(columnId) && isNoteTableCellValue(value),
        ),
      ),
      ...(headingBlockIds ? { headingBlockIds } : {}),
    };
  });

  const grouped = columns.some(
    (column) => column.id === table.groupColumnId && column.type === "select",
  );
  return { columns, rows, ...(grouped ? { groupColumnId: table.groupColumnId } : {}) };
};

export const formatNoteTableCellValue = (value: NoteTableCellValue | undefined) =>
  value === null || value === undefined ? "" : String(value);

export const parseNoteTableCellValue = (
  value: string,
  type: NoteTableColumnType,
): NoteTableCellValue => {
  if (type === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (type === "boolean") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1", "y"].includes(normalized)) return true;
    if (["false", "no", "0", "n"].includes(normalized)) return false;
    return null;
  }
  if (type === "date") {
    const trimmed = value.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
  }
  return value;
};

/** The text a cell shows: a select cell shows its choice's label, not the stored id. */
export const noteTableCellText = (
  column: NoteTableColumn,
  value: NoteTableCellValue | undefined,
) =>
  column.type === "select"
    ? (column.options?.find((option) => option.id === value)?.label ?? "")
    : formatNoteTableCellValue(value);

/** A cell as the table shows it: a tick for a checked box, otherwise its text. */
export const noteTableCellLabel = (
  column: NoteTableColumn,
  value: NoteTableCellValue | undefined,
) => (column.type === "boolean" ? (value === true ? "✓" : "") : noteTableCellText(column, value));

/** Reads pasted text into a cell; a select cell takes the choice with that label. */
export const parseNoteTableCellText = (column: NoteTableColumn, text: string) => {
  if (column.type !== "select") return parseNoteTableCellValue(text, column.type);
  const label = text.trim().toLowerCase();
  return column.options?.find((option) => option.label.toLowerCase() === label)?.id ?? "";
};

/** Orders cells as they appear: choices in list order, everything else by its text. */
export const compareNoteTableCells = (
  column: NoteTableColumn,
  left: NoteTableCellValue | undefined,
  right: NoteTableCellValue | undefined,
) => {
  if (column.type === "select") {
    const options = column.options ?? [];
    const rank = (value: NoteTableCellValue | undefined) => {
      const index = options.findIndex((option) => option.id === value);
      return index < 0 ? options.length : index;
    };
    return rank(left) - rank(right);
  }
  return noteTableCellText(column, left).localeCompare(
    noteTableCellText(column, right),
    undefined,
    {
      numeric: true,
      sensitivity: "base",
    },
  );
};

/**
 * Turns typed choice labels back into select options. A label that is still in the list
 * keeps its id, and a changed label takes over the id of the choice in its place, so the
 * cells that use a choice keep it while its name is retyped.
 */
export const reconcileNoteTableSelectOptions = (
  previous: readonly NoteTableSelectOption[],
  labels: readonly string[],
  createId: () => string = createUuid,
): NoteTableSelectOption[] => {
  const used = new Set<string>();
  const kept = labels.map((label) => {
    const match = previous.find((option) => option.label === label && !used.has(option.id));
    if (match) used.add(match.id);
    return match?.id;
  });
  return labels.map((label, index) => {
    const keptId = kept[index];
    if (keptId) return { id: keptId, label };
    const replaced = previous[index];
    const id = replaced && !used.has(replaced.id) ? replaced.id : createId();
    used.add(id);
    return { id, label };
  });
};

/** How many headings a row or column links to, as the end of its button's label. */
export const headingCountLabel = (count: number) => (count > 0 ? `, ${count} connected` : "");

import type { NoteTable, NoteTableCellValue } from "@loam/shared/notes/noteModel";

import { renderMarkdownTable } from "./blocksToMarkdown";
import { escapeMarkdownText } from "./inlineMarkdown";

/** Columns or rows in their saved order. */
export const byPosition = <T extends { position?: number }>(items: T[]) =>
  items
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        (left.item.position ?? left.index) - (right.item.position ?? right.index) ||
        left.index - right.index,
    )
    .map(({ item }) => item);

/** A cell's value as the table shows it. */
export const formatCell = (
  value: NoteTableCellValue | undefined,
  column: NoteTable["columns"][number],
) => {
  if (value === null || value === undefined || value === "") return "";
  if (column.type === "boolean") return value ? "Yes" : "No";
  if (column.type === "select") {
    return column.options?.find((option) => option.id === value)?.label ?? String(value);
  }
  return String(value);
};

/** A table tab as a GFM table, columns and rows in their saved order. */
export const buildNoteTableMarkdown = (table: NoteTable) => {
  const columns = byPosition(table.columns);
  if (columns.length === 0) return "";
  const cell = (text: string) =>
    escapeMarkdownText(text, { inTable: true }).replace(/\r?\n/g, "<br>").trim();
  return renderMarkdownTable([
    columns.map((column) => cell(column.title || "Column")),
    ...byPosition(table.rows).map((row) =>
      columns.map((column) => cell(formatCell(row.cells[column.id], column))),
    ),
  ]);
};

import { useRef } from "react";
import type { RenderEditCellProps } from "react-data-grid";

import { cn } from "../ui/cn";
import type { NoteTableCellValue, NoteTableColumn } from "@loam/shared/notes/noteModel";
import { Checkbox } from "../ui/Checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/Select";

import { formatNoteTableCellValue, parseNoteTableCellValue } from "./noteTable";

/** A table row as the grid holds it: cell values by column id, plus the row's id. */
export type TableGridRow = Record<string, NoteTableCellValue> & { __rowId: string };

const emptySelectValue = "__note_table_empty_value__";

function SelectCellEditor({
  commit,
  definition,
  onClose,
  value,
}: {
  /** Writes the chosen value and closes the editor in one grid update. */
  commit: (next: NoteTableCellValue) => void;
  definition: NoteTableColumn;
  onClose: (commitChanges?: boolean) => void;
  value: NoteTableCellValue;
}) {
  const openRef = useRef(false);
  const finishedRef = useRef(false);
  const finish = (commitChanges: boolean) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onClose(commitChanges);
  };
  const selectedValue = typeof value === "string" && value ? value : emptySelectValue;

  return (
    <Select
      value={selectedValue}
      onOpenChange={(nextOpen) => {
        const wasOpen = openRef.current;
        openRef.current = nextOpen;
        if (!nextOpen && wasOpen) finish(true);
      }}
      onValueChange={(nextValue) => {
        if (finishedRef.current) return;
        finishedRef.current = true;
        // A separate update + close would commit this render's row, which
        // does not contain the new value yet.
        commit(nextValue === emptySelectValue ? "" : nextValue);
      }}
    >
      <SelectTrigger
        aria-label={`Edit ${definition.title}`}
        autoFocus
        className={cn(
          "size-full min-h-0 rounded-none border-0 bg-(--app-page) px-2 shadow-none hover:bg-(--app-page)",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--app-focus-ring)",
        )}
        onBlur={() => {
          if (!openRef.current) finish(true);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          finish(false);
        }}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        align="start"
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          finish(false);
        }}
      >
        <SelectItem value={emptySelectValue}>None</SelectItem>
        {(definition.options ?? []).map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Edits one cell in place, with a control that suits the column's type. */
export function TableCellEditor({
  row,
  column,
  onRowChange,
  onClose,
  definition,
}: RenderEditCellProps<TableGridRow> & { definition: NoteTableColumn }) {
  const value = row[column.key] ?? null;
  const update = (next: NoteTableCellValue) => onRowChange({ ...row, [column.key]: next });
  const closeOnKey = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") onClose(false);
    if (event.key === "Enter") onClose(true);
  };

  if (definition.type === "boolean") {
    return (
      <label className="flex size-full items-center justify-center bg-(--app-page)">
        <Checkbox
          aria-label={`Edit ${definition.title}`}
          autoFocus
          checked={value === true}
          onBlur={() => onClose(true)}
          onCheckedChange={(nextChecked) => update(nextChecked === true)}
          onKeyDown={closeOnKey}
        />
      </label>
    );
  }

  if (definition.type === "select") {
    return (
      <SelectCellEditor
        commit={(next) => onRowChange({ ...row, [column.key]: next }, true)}
        definition={definition}
        onClose={onClose}
        value={value}
      />
    );
  }

  return (
    <input
      aria-label={`Edit ${definition.title}`}
      // The editor owns keyboard focus; otherwise typed keys reach global shortcuts.
      autoFocus
      className="size-full border-0 bg-(--app-page) px-2 text-xs text-(--app-text) outline-none"
      inputMode={definition.type === "number" ? "decimal" : undefined}
      onBlur={() => onClose(true)}
      onChange={(event) => update(parseNoteTableCellValue(event.target.value, definition.type))}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={closeOnKey}
      type={definition.type === "date" ? "date" : "text"}
      value={formatNoteTableCellValue(value)}
    />
  );
}

import { LinkIcon } from "lucide-react";
import { useState, type Ref } from "react";

import { NOTE_TABLE_COLUMN_TYPES, type NoteTableColumn } from "@loam/shared/notes/noteModel";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Label } from "../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/Select";

import { reconcileNoteTableSelectOptions, type NoteTableSelectOption } from "./noteTable";

const formatChoices = (options: readonly NoteTableSelectOption[] = []) =>
  options.map((option) => option.label).join(", ");

const parseChoices = (text: string) =>
  text
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);

function ChoicesInput({
  column,
  id,
  readOnly,
  onChange,
}: {
  column: NoteTableColumn;
  id: string;
  readOnly: boolean;
  onChange: (options: NoteTableSelectOption[]) => void;
}) {
  // While typing, the field keeps the raw text (so a trailing comma stays) and matches ids
  // against the choices as they were when editing began, so a retyped choice keeps its id.
  const [edit, setEdit] = useState<{ text: string; base: NoteTableSelectOption[] } | null>(null);

  return (
    <Input
      className="h-7 text-xs"
      disabled={readOnly}
      id={id}
      onBlur={() => setEdit(null)}
      onChange={(event) => {
        const base = edit?.base ?? column.options ?? [];
        setEdit({ text: event.target.value, base });
        onChange(reconcileNoteTableSelectOptions(base, parseChoices(event.target.value)));
      }}
      value={edit?.text ?? formatChoices(column.options)}
    />
  );
}

/**
 * The settings strip under the grid for the selected column. `onChange` passes a group key
 * for typing, so a burst of keystrokes in one field undoes as one step.
 */
export function TableColumnSettings({
  column,
  nameRef,
  readOnly,
  onChange,
  onManageHeadings,
}: {
  column: NoteTableColumn;
  /** The column name field, for focusing it when the settings are opened from a menu. */
  nameRef?: Ref<HTMLInputElement>;
  readOnly: boolean;
  onChange: (patch: Partial<NoteTableColumn>, group?: string) => void;
  onManageHeadings: () => void;
}) {
  const fieldId = (field: string) => `table-column-${field}-${column.id}`;
  const headingCount = column.headingBlockIds?.length ?? 0;

  return (
    <div className="grid gap-2 border-t border-(--app-border)/70 bg-(--app-page-2)/70 p-2 sm:grid-cols-[minmax(10rem,1fr)_9rem_minmax(12rem,1fr)_auto]">
      <div className="grid gap-1">
        <Label className="text-[10px]" htmlFor={fieldId("title")}>
          Column name
        </Label>
        <Input
          className="h-7 text-xs"
          disabled={readOnly}
          id={fieldId("title")}
          ref={nameRef}
          onChange={(event) =>
            onChange({ title: event.target.value || "Untitled column" }, `title:${column.id}`)
          }
          value={column.title}
        />
      </div>
      <div className="grid gap-1">
        <Label className="text-[10px]" htmlFor={fieldId("type")}>
          Type
        </Label>
        <Select
          value={column.type}
          onValueChange={(value) => {
            const type = NOTE_TABLE_COLUMN_TYPES.find((candidate) => candidate === value);
            if (type) onChange({ type });
          }}
          disabled={readOnly}
        >
          <SelectTrigger className="h-7" id={fieldId("type")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            {NOTE_TABLE_COLUMN_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {column.type === "select" ? (
        <div className="grid gap-1">
          <Label className="text-[10px]" htmlFor={fieldId("options")}>
            Choices, comma separated
          </Label>
          <ChoicesInput
            column={column}
            id={fieldId("options")}
            onChange={(options) => onChange({ options }, `options:${column.id}`)}
            readOnly={readOnly}
          />
        </div>
      ) : (
        <div />
      )}
      <Button
        aria-label={`Manage heading connections for ${column.title}`}
        className="min-h-7 self-end"
        onClick={onManageHeadings}
        size="sm"
        variant="outline"
      >
        <LinkIcon className="size-4" />
        Headings{headingCount > 0 ? ` (${headingCount})` : ""}
      </Button>
    </div>
  );
}

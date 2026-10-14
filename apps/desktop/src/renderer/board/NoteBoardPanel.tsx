import { useState, type DragEvent, type MutableRefObject } from "react";
import { MoreHorizontalIcon, PlusIcon } from "lucide-react";

import type { NoteTable, NoteTableRow } from "@loam/shared/notes/noteModel";
import type { TabHistoryCommands } from "../note/useTypedTabHistory";
import { noteTableCellText } from "../table/noteTable";
import { useTableDraft } from "../table/useTableDraft";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/DropdownMenu";
import {
  addCard,
  addGroup,
  boardGroups,
  cardFields,
  deleteCard,
  moveCard,
  renameCard,
  titleColumnOf,
  type BoardGroup,
} from "./noteBoard";

const CARD_TYPE = "application/x-loam-board-card";

/** A one-line field that commits on Enter or leaving it, and gives up on Escape. */
function InlineInput({
  label,
  initial = "",
  onCommit,
  onCancel,
}: {
  label: string;
  initial?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      aria-label={label}
      autoFocus
      value={value}
      className="w-full rounded-md border border-(--app-border) bg-(--app-page) px-2 py-1 text-sm text-(--app-text) outline-none focus:border-(--focus-ring)"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => (value.trim() ? onCommit(value.trim()) : onCancel())}
      onKeyDown={(event) => {
        if (event.key === "Enter" && value.trim()) onCommit(value.trim());
        if (event.key === "Escape") onCancel();
      }}
    />
  );
}

function BoardCard({
  table,
  row,
  groups,
  onCommit,
}: {
  table: NoteTable;
  row: NoteTableRow;
  groups: readonly BoardGroup[];
  onCommit: (next: NoteTable | null, group?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const titleColumn = titleColumnOf(table);
  const title = titleColumn ? noteTableCellText(titleColumn, row.cells[titleColumn.id]) : "";
  return (
    <li
      data-board-card={row.id}
      draggable={!editing}
      onDragStart={(event) => {
        event.dataTransfer.setData(CARD_TYPE, row.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      className="group/card cursor-grab rounded-lg border border-(--app-border) bg-(--app-page) p-2.5 shadow-xs active:cursor-grabbing"
    >
      <div className="flex items-start gap-1">
        {editing ? (
          <InlineInput
            label="Card title"
            initial={title}
            onCommit={(next) => {
              onCommit(renameCard(table, row.id, next));
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <button
            type="button"
            className="min-w-0 flex-1 text-left text-sm font-medium text-(--app-text)"
            onClick={() => setEditing(true)}
          >
            {title || <span className="text-(--app-muted)">Untitled</span>}
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost-muted"
              size="icon-xs"
              aria-label={`Actions for ${title || "card"}`}
              className="opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontalIcon className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Move to</DropdownMenuLabel>
            {groups.map((group) => (
              <DropdownMenuItem
                key={group.id}
                onSelect={() => onCommit(moveCard(table, row.id, group.id))}
              >
                {group.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onCommit(deleteCard(table, row.id))}>
              Delete card
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {cardFields(table, row).map((field) => (
        <p key={field.id} className="mt-1 truncate text-xs text-(--app-muted)">
          <span className="font-medium">{field.label}:</span> {field.text}
        </p>
      ))}
    </li>
  );
}

/**
 * A board tab: the tab's table as cards in columns, one per choice of its
 * group column. Cards move by dragging or from their menu; edits go through
 * the tab's undo history like a table's.
 */
export function NoteBoardPanel({
  tabId,
  table: storedTable,
  onUpdateTable,
  historyBridgeRef,
}: {
  tabId: string;
  table: NoteTable;
  onUpdateTable: (table: NoteTable) => void;
  historyBridgeRef: MutableRefObject<TabHistoryCommands | null>;
}) {
  const { table, commit } = useTableDraft({
    tabId,
    table: storedTable,
    onUpdateTable,
    historyBridgeRef,
  });
  const [adding, setAdding] = useState<string | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const groups = boardGroups(table);

  const dropOn = (event: DragEvent, groupId: string) => {
    const rowId = event.dataTransfer.getData(CARD_TYPE);
    setDropTarget(null);
    if (!rowId) return;
    event.preventDefault();
    const card = (event.target as Element).closest<HTMLElement>("[data-board-card]");
    commit(moveCard(table, rowId, groupId, card?.dataset.boardCard));
  };

  return (
    <div
      className="flex min-h-[34rem] w-full items-start gap-3 overflow-x-auto p-4"
      aria-label="Board"
    >
      {groups.map((group) => (
        <section
          key={group.id}
          aria-label={group.label}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(CARD_TYPE)) return;
            event.preventDefault();
            setDropTarget(group.id);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setDropTarget(null);
          }}
          onDrop={(event) => dropOn(event, group.id)}
          className={cn(
            "flex w-56 shrink-0 flex-col gap-2 rounded-xl bg-(--app-page-2) p-2 transition-colors",
            dropTarget === group.id && "ring-2 ring-(--focus-ring)",
          )}
        >
          <h2 className="flex items-center justify-between px-1 text-xs font-medium text-(--app-muted)">
            <span className="truncate">{group.label}</span>
            <span className="tabular-nums">{group.rows.length}</span>
          </h2>
          <ul className="flex min-h-8 flex-col gap-2">
            {group.rows.map((row) => (
              <BoardCard key={row.id} table={table} row={row} groups={groups} onCommit={commit} />
            ))}
          </ul>
          {adding === group.id ? (
            <InlineInput
              label={`New card in ${group.label}`}
              onCommit={(title) => {
                commit(addCard(table, group.id, title));
                setAdding(null);
              }}
              onCancel={() => setAdding(null)}
            />
          ) : (
            <Button
              type="button"
              variant="ghost-muted"
              size="sm"
              className="justify-start text-(--app-muted)"
              onClick={() => setAdding(group.id)}
            >
              <PlusIcon className="size-3.5" />
              Add card
            </Button>
          )}
        </section>
      ))}
      <div className="shrink-0 pr-2">
        {addingGroup ? (
          <InlineInput
            label="New column"
            onCommit={(label) => {
              commit(addGroup(table, label));
              setAddingGroup(false);
            }}
            onCancel={() => setAddingGroup(false)}
          />
        ) : (
          <Button
            type="button"
            variant="ghost-muted"
            size="sm"
            className="text-(--app-muted)"
            onClick={() => setAddingGroup(true)}
          >
            <PlusIcon className="size-3.5" />
            Add column
          </Button>
        )}
      </div>
    </div>
  );
}

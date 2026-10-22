import { ChevronDownIcon, ChevronUpIcon, CopyIcon, LinkIcon, Trash2Icon } from "lucide-react";

import type { NoteTableRow } from "@loam/shared/notes/noteModel";
import { Button } from "../ui/Button";

import { headingCountLabel } from "./noteTable";
import type { NoteTableRowAction } from "./tableCommands";

/** The buttons for the selected row, beside the table's filter. */
export function TableRowActions({
  row,
  readOnly,
  isReordered,
  onAction,
  onManageHeadings,
}: {
  row: NoteTableRow;
  readOnly: boolean;
  /** A filter or sort is on, so the rows show out of their stored order. */
  isReordered: boolean;
  onAction: (action: NoteTableRowAction) => void;
  onManageHeadings: () => void;
}) {
  return (
    <div className="flex items-center gap-1 border-l border-(--app-border)/70 pl-1.5">
      {/* Moving follows the stored order, which a filtered or sorted view does not show. */}
      <Button
        disabled={readOnly || isReordered}
        onClick={() => onAction("up")}
        size="icon-xs"
        title="Move row up"
        variant="ghost-muted"
      >
        <ChevronUpIcon className="size-4" />
      </Button>
      <Button
        disabled={readOnly || isReordered}
        onClick={() => onAction("down")}
        size="icon-xs"
        title="Move row down"
        variant="ghost-muted"
      >
        <ChevronDownIcon className="size-4" />
      </Button>
      <Button
        disabled={readOnly}
        onClick={() => onAction("duplicate")}
        size="icon-xs"
        title="Duplicate row"
        variant="ghost-muted"
      >
        <CopyIcon className="size-4" />
      </Button>
      <Button
        aria-label={`Manage heading connections for selected row${headingCountLabel(
          row.headingBlockIds?.length ?? 0,
        )}`}
        onClick={onManageHeadings}
        size="icon-xs"
        title="Manage heading connections"
        variant="ghost-muted"
      >
        <LinkIcon className="size-4" />
      </Button>
      <Button
        disabled={readOnly}
        onClick={() => onAction("delete")}
        size="icon-xs"
        title="Delete row"
        variant="ghost-muted"
      >
        <Trash2Icon className="size-4" />
      </Button>
    </div>
  );
}

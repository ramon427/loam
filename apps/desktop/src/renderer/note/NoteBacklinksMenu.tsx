import { useState, type ReactNode } from "react";
import { LinkIcon } from "lucide-react";

import { Button } from "../ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../ui/DropdownMenu";
import { getNoteLinkTitle } from "../editor/noteMentions";
import { NoteRouteGlyph } from "../ui/NoteRouteIcon";
import { formatBacklinkDate, useNoteBacklinks } from "./noteBacklinks";

const describeBacklinkCount = (count: number) =>
  count === 1 ? "Linked from 1 place" : `Linked from ${count} places`;

const triggerClassName =
  "h-8 min-w-8 gap-1 border-0 bg-transparent px-2 text-(--app-muted) shadow-none hover:bg-(--app-page-2)/60 hover:text-(--app-text) data-[state=open]:text-(--app-text)";

function BacklinkMenuMessage({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1.5 text-xs leading-5 text-(--app-muted)">{children}</p>;
}

/** Header action listing the other notes that link to this note; choosing one opens it. */
export function NoteBacklinksMenu({
  noteId,
  onOpenNote,
}: {
  noteId: string;
  onOpenNote: (noteId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // Read again whenever a note is saved (see NotesWorkspace) or the menu opens.
  const backlinksQuery = useNoteBacklinks(noteId);
  const backlinks = backlinksQuery.data;
  const total = backlinks?.noteCount ?? 0;
  const triggerLabel = backlinks ? describeBacklinkCount(total) : "Linked from";

  let body: ReactNode;
  if (backlinks && total === 0) {
    body = (
      <BacklinkMenuMessage>
        Nothing links to this note yet. Type @ in another note to link it.
      </BacklinkMenuMessage>
    );
  } else if (backlinks) {
    body = (
      <>
        {backlinks.notes.map((note) => (
          <DropdownMenuItem
            key={note.id}
            data-testid="note-backlink-row"
            onSelect={() => onOpenNote(note.id)}
          >
            <NoteRouteGlyph aria-hidden className="size-4" />
            <span className="min-w-0 flex-1 truncate">{getNoteLinkTitle(note.title)}</span>
            {/* Notes have no calendar day; show when the linking note last changed. */}
            <span className="shrink-0 text-[11px] text-(--muted-text) tabular-nums">
              {formatBacklinkDate(note.updatedAt)}
            </span>
          </DropdownMenuItem>
        ))}
        {total > backlinks.notes.length ? (
          <BacklinkMenuMessage>
            Showing the {backlinks.notes.length} most recent.
          </BacklinkMenuMessage>
        ) : null}
      </>
    );
  } else if (backlinksQuery.isError) {
    body = (
      <>
        <BacklinkMenuMessage>Couldn&apos;t load links to this note.</BacklinkMenuMessage>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            void backlinksQuery.refetch();
          }}
        >
          Try again
        </DropdownMenuItem>
      </>
    );
  } else {
    body = <BacklinkMenuMessage>Loading links</BacklinkMenuMessage>;
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen && !backlinksQuery.isFetching) void backlinksQuery.refetch();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost-muted"
          size="sm"
          aria-label={triggerLabel}
          title={triggerLabel}
          data-testid="note-backlinks-trigger"
          className={triggerClassName}
        >
          <LinkIcon className="size-4" aria-hidden="true" />
          {total > 0 ? <span className="text-xs tabular-nums">{total}</span> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-label="Linked from"
        className="w-[min(20rem,calc(100vw-2rem))] max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto"
      >
        <DropdownMenuLabel>Linked from</DropdownMenuLabel>
        {body}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

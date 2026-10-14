import type { ReactNode } from "react";

import { Skeleton } from "../ui/Skeleton";

/**
 * The open note's header row: its title, then its actions (links to it,
 * undo and redo). Find in note searches the title through
 * `data-note-header-title`.
 */
export function NoteHeader({ title, actions }: { title: ReactNode; actions: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div data-note-header-title className="flex min-w-0 flex-1 items-center">
        {title}
      </div>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </div>
  );
}

/** The header of a note still loading: its size, without its content. */
export function NoteHeaderSkeleton() {
  return (
    <NoteHeader
      title={
        <div className="flex h-7 items-center px-[13px]">
          <h1 className="sr-only">Loading note</h1>
          <Skeleton className="h-5 w-56 max-w-full" />
        </div>
      }
      actions={null}
    />
  );
}

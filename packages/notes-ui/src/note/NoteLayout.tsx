import type { ReactNode } from "react";

import { NotesMainHeader } from "../extensions/NotesExtensions";

/**
 * The main column: the header row along the top of the window and, under it,
 * the page, which alone scrolls. Code that scrolls the page finds it through
 * `data-note-scroll`.
 */
export function NoteLayout({ header, children }: { header?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col font-(--font-body) text-(--app-text)">
      <NotesMainHeader>{header}</NotesMainHeader>
      <div
        data-note-scroll
        className="relative isolate flex min-h-0 flex-1 flex-col overflow-x-clip overflow-y-auto max-md:px-3 max-md:pt-3 max-md:pb-[calc(env(safe-area-inset-bottom)+1rem)]"
      >
        {children}
      </div>
    </div>
  );
}

import { Fragment, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";

import { NoteProjectIcon } from "../sidebar/NoteProjectIcon";
import { fastUiTransitionClass } from "../styles/motion";
import { cn } from "../ui/cn";
import type { NotePath } from "./notePath";

const crumbClass = "flex h-7 max-w-44 min-w-0 shrink items-center gap-1.5 px-1.5 text-[14px]";

/**
 * The project, folder and parent notes above the open note, before its title. Only the parent
 * notes open; the project and folder just say where the note is.
 */
export function NoteBreadcrumbs({
  path,
  onOpenNote,
}: {
  path: NotePath;
  onOpenNote: (noteId: string) => void;
}) {
  const crumbs: Array<{ key: string; node: ReactNode }> = [];
  if (path.project)
    crumbs.push({
      key: path.project.id,
      node: (
        <span className={cn(crumbClass, "text-(--app-muted)")}>
          <NoteProjectIcon icon={path.project.icon} className="size-3.5 shrink-0" />
          <span className="truncate">{path.project.name}</span>
        </span>
      ),
    });
  if (path.folder)
    crumbs.push({
      key: path.folder.id,
      node: (
        <span className={cn(crumbClass, "text-(--app-muted)")}>
          <span className="truncate">{path.folder.name}</span>
        </span>
      ),
    });
  for (const parent of path.parents)
    crumbs.push({
      key: parent.id,
      node: (
        <button
          type="button"
          className={cn(
            crumbClass,
            fastUiTransitionClass,
            "cursor-pointer transition-colors rounded-md text-(--app-secondary-label) hover:bg-(--app-control-hover) hover:text-(--app-text) focus-visible:ring-1 focus-visible:ring-(--control-border-strong) focus-visible:outline-none",
          )}
          onClick={() => onOpenNote(parent.id)}
        >
          <span className="truncate">{parent.title.trim() || "Untitled note"}</span>
        </button>
      ),
    });
  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="Note location" className="flex max-w-[60%] min-w-0 shrink-0 items-center">
      <ol className="m-0 flex min-w-0 list-none items-center p-0 pl-[7px]">
        {crumbs.map(({ key, node }) => (
          <Fragment key={key}>
            <li className="flex min-w-0 shrink items-center">{node}</li>
            <li aria-hidden="true" className="flex shrink-0 items-center text-(--app-muted)/60">
              <ChevronRightIcon className="size-3.5" />
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

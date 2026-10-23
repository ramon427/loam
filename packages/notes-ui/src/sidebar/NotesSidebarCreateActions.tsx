import { FolderPlusIcon, PackagePlusIcon, SquarePenIcon } from "lucide-react";

import { Button } from "../ui/Button";

import { useNotesTreeCommands } from "./useNotesTreeCommands";

/** Icon buttons in the sidebar's header. */
export const sidebarActionClass =
  "size-[30px] min-h-[30px] min-w-[30px] shrink-0 text-(--app-icon-muted) hover:text-(--app-text) [&_svg:not([class*='size-'])]:size-4";

/** A sidebar action whose option is on. */
export const sidebarActionActiveClass =
  "bg-(--app-accent-muted) text-(--app-text) hover:bg-(--app-accent-muted) hover:text-(--app-text)";

/**
 * The sidebar header's New project, New folder and New note buttons. New note, the one used most,
 * sits on the header's outer edge: last when the buttons are on the right, first on the left.
 */
export function NotesSidebarCreateActions({
  disabled = false,
  folderId,
  projectId,
  onCreateFolder,
  align = "end",
}: {
  disabled?: boolean;
  /** The folder new notes go in, while the sidebar shows one folder. */
  folderId?: string | null;
  /** The project new notes and folders go in, while the sidebar shows only that one. */
  projectId?: string;
  /** Runs before the new-folder field opens, so the tree can show where it goes. */
  onCreateFolder?: () => void;
  /** Which side of the header the buttons are on. */
  align?: "start" | "end";
}) {
  const commands = useNotesTreeCommands();
  const buttons = [
    <Button
      key="project"
      type="button"
      variant="ghost-muted"
      size="icon-sm"
      className={sidebarActionClass}
      aria-label="New project"
      title="New project"
      disabled={disabled}
      onClick={commands.startProjectCreation}
    >
      <PackagePlusIcon className="size-4" aria-hidden="true" />
    </Button>,
    <Button
      key="folder"
      type="button"
      variant="ghost-muted"
      size="icon-sm"
      className={sidebarActionClass}
      aria-label="New folder"
      title="New folder"
      disabled={disabled}
      onClick={() => {
        onCreateFolder?.();
        commands.startFolderCreation(projectId ?? null);
      }}
    >
      <FolderPlusIcon className="size-4" aria-hidden="true" />
    </Button>,
    <Button
      key="note"
      type="button"
      variant="ghost-muted"
      size="icon-sm"
      className={sidebarActionClass}
      aria-label="New note"
      title="New note"
      disabled={disabled}
      onClick={() => void commands.createNote({ folderId: folderId ?? undefined, projectId })}
    >
      <SquarePenIcon className="size-4" aria-hidden="true" />
    </Button>,
  ];
  return (
    <div className="flex shrink-0 items-center" role="group" aria-label="Create in Notes">
      {align === "start" ? [...buttons].reverse() : buttons}
    </div>
  );
}

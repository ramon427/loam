import { FolderPlusIcon, PackagePlusIcon, SquarePenIcon } from "lucide-react";

import { Button } from "../ui/Button";

import { useNotesTreeCommands } from "./useNotesTreeCommands";

/** Icon buttons in the sidebar's header, which stay muted on hover. */
export const sidebarActionClass =
  "min-h-7 min-w-7 shrink-0 text-(--app-muted) hover:text-(--app-muted)";

/** A sidebar action whose option is on. */
export const sidebarActionActiveClass =
  "bg-(--app-accent-muted) text-(--app-text) hover:bg-(--app-accent-muted) hover:text-(--app-text)";

/** The sidebar header's New project, New folder and New note buttons. */
export function NotesSidebarCreateActions({
  disabled = false,
  folderId,
  projectId,
  onCreateFolder,
}: {
  disabled?: boolean;
  /** The folder new notes go in, while the sidebar shows one folder. */
  folderId?: string | null;
  /** The project new notes and folders go in, while the sidebar shows only that one. */
  projectId?: string;
  /** Runs before the new-folder field opens, so the tree can show where it goes. */
  onCreateFolder?: () => void;
}) {
  const commands = useNotesTreeCommands();
  return (
    <div className="flex shrink-0 items-center" role="group" aria-label="Create in Notes">
      <Button
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
      </Button>
      <Button
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
      </Button>
      <Button
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
      </Button>
    </div>
  );
}

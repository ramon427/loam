import { PlusIcon } from "lucide-react";

import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";

export function NotesOpenEmptyState({
  missing = false,
  onCreateNote,
}: {
  /** The linked note does not exist or was deleted. */
  missing?: boolean;
  onCreateNote: () => void;
}) {
  return (
    <EmptyState
      title={missing ? "This note is not available" : "Open a note"}
      titleAs="h1"
      description={
        missing
          ? "It may have been deleted, or the link is incomplete. Choose another note from the Notes sidebar, or create a new one."
          : "Choose a note from the Notes sidebar, or create a new one."
      }
      className="min-h-[24rem] flex-1"
      slotClassNames={{
        title: "text-lg leading-7",
        description: "max-w-md text-sm leading-6",
        action: "mt-3",
      }}
      action={
        <Button size="lg" onClick={onCreateNote}>
          <PlusIcon className="size-4" />
          New note
        </Button>
      }
    />
  );
}

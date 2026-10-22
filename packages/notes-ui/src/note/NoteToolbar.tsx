import type { ComponentProps } from "react";
import { Undo2Icon, Redo2Icon } from "lucide-react";

import { cn } from "../ui/cn";
import { Button } from "../ui/Button";

const HistoryButton = ({ className, ...props }: ComponentProps<typeof Button>) => (
  <Button
    {...props}
    variant="ghost-muted"
    size="icon-sm"
    className={cn(
      "size-7 rounded-md border-0 bg-transparent text-(--app-muted)/60 shadow-none transition-[color,background-color,opacity] duration-(--duration-fast) ease-(--ease-out) hover:bg-(--app-page-2)/60 hover:text-(--app-text) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--focus-ring)",
      className,
    )}
  />
);

/** Undo and redo for the tab in view. */
export function NoteToolbar({ onUndo, onRedo }: { onUndo: () => void; onRedo: () => void }) {
  return (
    <div className="ml-auto flex shrink-0 flex-nowrap items-center justify-end gap-1.5">
      <HistoryButton aria-label="Undo note edit" title="Undo" onClick={onUndo}>
        <Undo2Icon className="size-4" />
      </HistoryButton>
      <HistoryButton aria-label="Redo note edit" title="Redo" onClick={onRedo}>
        <Redo2Icon className="size-4" />
      </HistoryButton>
    </div>
  );
}

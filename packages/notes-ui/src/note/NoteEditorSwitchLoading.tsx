import { LoaderCircleIcon } from "lucide-react";

import { cn } from "../ui/cn";
import { editorStyles as styles } from "../editor/blocknote/blockNoteStyles";

export function NoteEditorSwitchLoading({ label }: { label: string }) {
  return (
    <output
      className={cn(
        styles.notesEditorSwitchLoading,
        "flex min-h-full w-full items-start justify-end py-4 text-(--app-muted) sm:py-6",
      )}
      aria-label={label}
      aria-live="polite"
    >
      <LoaderCircleIcon
        aria-hidden="true"
        className="size-5 animate-spin motion-reduce:animate-none"
      />
    </output>
  );
}

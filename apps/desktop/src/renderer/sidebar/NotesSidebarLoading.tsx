import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { Skeleton } from "../ui/Skeleton";
import { Notice } from "../ui/Notice";

const notesSidebarLoadingRows = [
  { id: "folder-a", kind: "folder", width: "w-[42%]" },
  { id: "note-a", kind: "note", width: "w-[58%]", indent: true },
  { id: "note-b", kind: "note", width: "w-[51%]", indent: true },
  { id: "folder-b", kind: "folder", width: "w-[36%]" },
  { id: "note-c", kind: "note", width: "w-[62%]", indent: true },
  { id: "note-d", kind: "note", width: "w-[47%]", indent: true },
  { id: "note-e", kind: "note", width: "w-[55%]" },
  { id: "note-f", kind: "note", width: "w-[49%]" },
] as const;

export function NotesSidebarLoading() {
  return (
    <div className="space-y-1" role="status" aria-live="polite" aria-label="Loading notes">
      <span className="sr-only">Loading notes...</span>
      <div className="space-y-0.5 px-0">
        {notesSidebarLoadingRows.map((row) => (
          <div
            key={row.id}
            className={cn(
              "flex h-[34px] items-center gap-2 pr-2",
              row.kind === "folder" ? "pl-1" : "pl-[26px]",
              "indent" in row && row.indent && "pl-[38px]",
            )}
          >
            {row.kind === "folder" ? <span className="size-3.5 shrink-0" /> : null}
            <Skeleton className="size-4 shrink-0 -translate-y-px rounded-sm" />
            <Skeleton className={cn("h-3.5 rounded", row.width)} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The library could not be read: say so, rather than showing an empty library. */
export function NotesSidebarReadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="grid gap-2 px-1 py-1">
      <Notice tone="danger">Your notes could not be loaded. Nothing was changed.</Notice>
      <Button
        type="button"
        variant="outlineMuted"
        size="sm"
        className="justify-self-start"
        onClick={onRetry}
      >
        Try again
      </Button>
    </div>
  );
}

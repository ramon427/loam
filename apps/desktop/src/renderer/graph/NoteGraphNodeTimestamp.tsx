import { cn } from "../ui/cn";
import { buttonVariants } from "../ui/Button";
import { ClockIcon } from "lucide-react";
import { formatVideoTimestamp } from "@loam/shared/notes/noteVideo";

export function NoteGraphNodeTimestamp({
  onSeek,
  seconds,
}: {
  onSeek?: (seconds: number) => void;
  seconds: number;
}) {
  const label = formatVideoTimestamp(seconds);
  if (onSeek) {
    return (
      <button
        aria-label={`Seek video to ${label}`}
        className={cn(
          buttonVariants({ variant: "secondary", size: "sm" }),
          "nodrag nowheel mt-2 w-fit",
        )}
        onClick={(event) => {
          event.stopPropagation();
          onSeek(seconds);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        title="Seek video to this timestamp"
        type="button"
      >
        <ClockIcon className="size-3" />
        {label}
      </button>
    );
  }
  return (
    <div className="mt-2 inline-flex h-5 w-fit items-center gap-1 rounded border border-current/20 bg-white/65 px-1.5 font-mono text-[10px] dark:bg-slate-950/65">
      <ClockIcon className="size-3" />
      {label}
    </div>
  );
}

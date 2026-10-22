import {
  ChevronDownIcon,
  LinkIcon,
  MaximizeIcon,
  MinimizeIcon,
  SquarePlayIcon,
  Trash2Icon,
} from "lucide-react";

import { folderTabClass, folderTabColorClass } from "../note/TabStrip";
import { cn } from "../ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/DropdownMenu";

/**
 * The video's tab at the far end of the note's tabs. It stands over the
 * video column of the paper: shown while the video is, behind the paper
 * otherwise. Its menu changes or removes the video.
 */
export function VideoTab({
  title,
  hasVideo,
  open,
  maximized,
  onToggle,
  onToggleMaximized,
  onChangeVideo,
  onRemoveVideo,
}: {
  title: string | undefined;
  hasVideo: boolean;
  open: boolean;
  maximized: boolean;
  onToggle: () => void;
  onToggleMaximized: () => void;
  onChangeVideo: () => void;
  onRemoveVideo: () => void;
}) {
  const label = hasVideo ? title?.trim() || "Video" : "Add video";
  return (
    <div
      data-note-video-tab
      className={cn(
        folderTabClass,
        folderTabColorClass(open),
        "mr-3 min-w-0 gap-1 self-end px-0 focus-visible:ring-0",
      )}
    >
      <button
        type="button"
        aria-pressed={open}
        aria-label={open ? "Hide video" : hasVideo ? "Show video" : "Add video"}
        title={label}
        onClick={onToggle}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-t-lg pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-(--focus-ring)"
      >
        <SquarePlayIcon className="size-3.5 shrink-0 text-current/80" />
        <span className={cn("block truncate", !hasVideo && "pr-2")}>{label}</span>
      </button>
      {hasVideo ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Video options"
              className="mr-1 grid size-5 shrink-0 place-items-center rounded text-(--app-muted) outline-none hover:bg-(--app-page-2) hover:text-(--app-text) focus-visible:ring-2 focus-visible:ring-(--focus-ring)"
            >
              <ChevronDownIcon className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" className="min-w-48">
            <DropdownMenuItem onSelect={onToggleMaximized}>
              {maximized ? <MinimizeIcon /> : <MaximizeIcon />}
              {maximized ? "Show the note beside it" : "Fill the paper with the video"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onChangeVideo}>
              <LinkIcon />
              Change video…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onRemoveVideo}>
              <Trash2Icon />
              Remove video
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

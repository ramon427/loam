import { useEffect, useId, useState, type DragEvent } from "react";
import { SquarePlayIcon } from "lucide-react";

import { parseYouTubeUrl, type ParsedYouTubeUrl } from "@loam/shared/notes/noteVideo";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { Input } from "../ui/Input";
import { Label } from "../ui/Label";

/** The text a drag carries: a link dragged from a browser, or plain text. */
const draggedText = (event: DragEvent) =>
  event.dataTransfer.getData("text/uri-list").split(/\r?\n/u)[0] ||
  event.dataTransfer.getData("text/plain");

/**
 * Where the video column asks for a YouTube link: paste one, drop one, or
 * press Enter on the link already copied. A valid link pasted or dropped
 * attaches at once.
 */
export function VideoLinkForm({
  currentUrl,
  autoFocus,
  onChoose,
  onCancel,
}: {
  /** The attached video's link, when changing it. */
  currentUrl: string;
  autoFocus: boolean;
  onChoose: (video: ParsedYouTubeUrl) => void;
  /** Leaves the video as it is; only offered while changing one. */
  onCancel?: () => void;
}) {
  const inputId = useId();
  const [url, setUrl] = useState(currentUrl);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const changing = currentUrl.length > 0;

  // A YouTube link already on the clipboard is likely the one wanted.
  useEffect(() => {
    if (changing) return;
    let current = true;
    navigator.clipboard
      ?.readText?.()
      .then((text) => {
        if (current && parseYouTubeUrl(text)) setUrl((typed) => typed || text.trim());
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [changing]);

  const choose = (value: string) => {
    const video = parseYouTubeUrl(value);
    if (video) onChoose(video);
    else setError("That isn't a YouTube video link.");
  };

  return (
    <form
      className={cn(
        "flex min-h-64 flex-1 flex-col items-center justify-center gap-3 rounded-lg border-[1.5px] border-dashed border-(--app-border) px-5 py-8 text-center transition-colors",
        dragging &&
          "border-(--app-accent) bg-[color-mix(in_srgb,var(--app-accent)_6%,transparent)]",
      )}
      onSubmit={(event) => {
        event.preventDefault();
        choose(url);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const text = draggedText(event);
        setUrl(text);
        choose(text);
      }}
    >
      <SquarePlayIcon className="size-6 text-(--app-muted)" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-(--app-text)">
          {changing ? "Change the video" : "Watch a YouTube video beside this note"}
        </p>
        <p className="text-xs text-(--app-muted)">
          Paste or drop its link. Timestamps you write jump to that moment.
        </p>
      </div>
      <div className="w-full max-w-80 space-y-1.5 text-left">
        <Label className="sr-only" htmlFor={inputId}>
          YouTube link
        </Label>
        <Input
          id={inputId}
          value={url}
          autoFocus={autoFocus}
          placeholder="https://www.youtube.com/watch?v=…"
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setUrl(event.target.value);
            setError(null);
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text/plain");
            if (!parseYouTubeUrl(pasted)) return;
            event.preventDefault();
            setUrl(pasted.trim());
            choose(pasted);
          }}
        />
        {error ? <p className="text-xs text-(--status-danger)">{error}</p> : null}
      </div>
      <div className="flex gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost-muted" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={!url.trim()}>
          {changing ? "Change video" : "Attach video"}
        </Button>
      </div>
    </form>
  );
}

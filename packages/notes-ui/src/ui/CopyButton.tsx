import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { Button } from "./Button";
import { cn } from "./cn";
import { toastError } from "./toast";

/** How long the check shows after copying. */
const COPIED_FOR_MS = 1000;

/**
 * Copies `text()` to the clipboard. The copy icon turns into a check for a
 * moment, the two crossfading in place, and says so to screen readers.
 */
export function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: () => string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_FOR_MS);
    } catch {
      toastError("Couldn't copy to the clipboard.");
    }
  };

  const icon =
    "col-start-1 row-start-1 transition-opacity duration-(--duration-fast) motion-reduce:transition-none";
  return (
    <Button
      size="icon-xs"
      variant="ghost-muted"
      aria-label={copied ? "Copied" : label}
      data-copy-state={copied ? "copied" : "idle"}
      className={className}
      onClick={() => void copy()}
    >
      <span className="grid place-items-center" aria-hidden>
        <CopyIcon className={cn(icon, copied && "opacity-0")} />
        <CheckIcon className={cn(icon, !copied && "opacity-0")} />
      </span>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </Button>
  );
}

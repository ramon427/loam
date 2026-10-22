import { ClockIcon, CornerDownLeftIcon, PencilIcon, XIcon } from "lucide-react";

import { Button } from "@loam/notes-ui/ui/Button";
import { cn } from "@loam/notes-ui/ui/cn";

import styles from "./aiChat.module.css";
import type { QueuedPrompt } from "./usePromptQueue";

/** Messages written while a reply runs, waiting their turn above the composer. */
export function AiChatPromptQueue({
  prompts,
  onSendNow,
  onEdit,
  onRemove,
}: {
  prompts: readonly QueuedPrompt[];
  onSendNow: (key: QueuedPrompt["key"]) => void;
  /** Takes the message out of the queue and back into the composer. */
  onEdit: (prompt: QueuedPrompt) => void;
  onRemove: (key: QueuedPrompt["key"]) => void;
}) {
  return (
    <ol className="flex flex-col gap-1" aria-label="Waiting to send">
      {prompts.map((prompt) => (
        <li
          key={prompt.key}
          className={cn(
            "group flex min-w-0 items-center gap-2 rounded-(--radius-control) border border-dashed border-(--app-border) py-0.5 pr-0.5 pl-2 text-xs text-(--app-muted)",
            styles.riseIn,
            styles.fast,
          )}
        >
          <ClockIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            {prompt.text || prompt.attachments.map((attachment) => attachment.name).join(", ")}
          </span>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Send now"
            title="Stop the reply and send this now"
            onClick={() => onSendNow(prompt.key)}
          >
            <CornerDownLeftIcon aria-hidden />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Edit"
            disabled={prompt.attachments.length > 0}
            onClick={() => onEdit(prompt)}
          >
            <PencilIcon aria-hidden />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Remove"
            onClick={() => onRemove(prompt.key)}
          >
            <XIcon aria-hidden />
          </Button>
        </li>
      ))}
    </ol>
  );
}

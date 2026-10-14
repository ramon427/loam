import { FileTextIcon } from "lucide-react";

import { cn } from "../ui/cn";

import styles from "./aiChat.module.css";
import type { MentionableNote } from "./useNoteMentions";

/**
 * The notes an @ in the message can name. The message keeps the focus: the
 * highlighted option is announced through its `aria-activedescendant`, by
 * the option ids `${id}-${index}`.
 */
export function AiChatMentionMenu({
  id,
  matches,
  highlight,
  onPick,
}: {
  id: string;
  matches: readonly MentionableNote[];
  highlight: number;
  onPick: (note: MentionableNote) => void;
}) {
  return (
    <ul
      id={id}
      role="listbox"
      aria-label="Notes"
      className={cn(
        "flex flex-col rounded-(--radius-control) border border-(--app-border) bg-(--app-surface) p-1 shadow-md",
        styles.riseIn,
        styles.fast,
      )}
    >
      {matches.map((note, index) => (
        <li
          key={note.id}
          id={`${id}-${index}`}
          role="option"
          aria-selected={index === highlight}
          className={cn(
            "flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1 text-xs",
            index === highlight && "bg-(--app-surface-2)",
          )}
          // Keeps the focus in the message while choosing.
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onPick(note)}
        >
          <FileTextIcon className="size-3.5 shrink-0 text-(--app-muted)" aria-hidden />
          <span className="truncate">{note.title.trim() || "Untitled"}</span>
        </li>
      ))}
    </ul>
  );
}

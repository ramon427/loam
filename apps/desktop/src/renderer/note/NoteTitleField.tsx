import { useEffect, useRef, useState } from "react";

import { cn } from "../ui/cn";
import { Input } from "../ui/Input";

const titleClass =
  "box-border h-7 min-h-7 w-full min-w-0 border-0 bg-transparent px-[13px] py-0 text-[15px] font-medium leading-7 tracking-normal text-(--app-text) shadow-none md:text-[16px]";

/**
 * The note's title, typed in place. `focusRequest` focuses it once per new
 * value, as a new note asks for.
 */
export function NoteTitleField({
  value,
  onChange,
  focusRequest,
}: {
  value: string;
  onChange: (title: string) => void;
  focusRequest?: number | null;
}) {
  // The note's title reaches this field a moment after each keystroke; typing
  // shows the draft meanwhile, and a title changed elsewhere replaces it.
  const [draft, setDraft] = useState(value);
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    setDraft(value);
  }
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (focusRequest != null) inputRef.current?.focus({ preventScroll: true });
  }, [focusRequest]);

  const placeholder = "Untitled note...";
  return (
    <h1 className="relative m-0 w-full min-w-0" aria-label={draft.trim() ? draft : placeholder}>
      <Input
        ref={inputRef}
        type="text"
        data-note-title-field="true"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(event.target.value);
        }}
        placeholder={placeholder}
        aria-label={draft.trim() ? draft : placeholder}
        className={cn(
          titleClass,
          "placeholder:text-(--app-muted)/50",
          // Focuses like the note's other inputs; a halo ring outshouts them on a heading.
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-(--control-border-strong)",
        )}
      />
    </h1>
  );
}

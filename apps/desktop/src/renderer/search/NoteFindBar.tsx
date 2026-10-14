import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";

import { formatShortcut, matchesShortcut, shortcuts } from "../keyboard/shortcuts";
import { Button } from "../ui/Button";
import { SearchField } from "../ui/SearchField";
import { useNotesWorkspace } from "../workspace/NotesWorkspace";
import { findNoteTextRanges } from "./noteFindRanges";

type FindTarget = { noteId: string; query: string };

export type NoteFindBarHandle = {
  /** Shows the bar over `noteId` (default: the open note), searching `query` or the selection. */
  find: (request?: { noteId?: string; query?: string }) => void;
};

export function NoteFindBar({ ref }: { ref: Ref<NoteFindBarHandle> }) {
  const { activeNoteId } = useNotesWorkspace();
  const [target, setTarget] = useState<FindTarget | null>(null);
  const [ranges, setRanges] = useState<Range[]>([]);
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const reveal = useRef(false);
  const visible = target !== null && target.noteId === activeNoteId;
  const query = visible ? target.query : "";

  useImperativeHandle(
    ref,
    () => ({
      find: (request = {}) => {
        const noteId = request.noteId ?? activeNoteId;
        if (!noteId) return;
        if (document.activeElement instanceof HTMLElement)
          previousFocus.current = document.activeElement;
        const selection = window.getSelection()?.toString().trim().slice(0, 200);
        setTarget((current) => ({
          noteId,
          query: request.query ?? (selection || (current?.noteId === noteId ? current.query : "")),
        }));
        setIndex(0);
        reveal.current = true;
        requestAnimationFrame(() => {
          input.current?.focus();
          input.current?.select();
        });
      },
    }),
    [activeNoteId],
  );

  useEffect(() => {
    if (!visible) return;
    input.current?.focus();
    input.current?.select();
  }, [visible, activeNoteId]);

  useEffect(() => {
    if (!visible) {
      setRanges([]);
      return;
    }
    // The main column outlives each note's frame, which a note opening replaces.
    const root = document.getElementById("main-content");
    if (!root) return;
    let frame = 0;
    const scan = () => {
      const matches = findNoteTextRanges(root, query);
      setRanges(matches);
      setIndex((current) => Math.min(current, Math.max(0, matches.length - 1)));
    };
    scan();
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(scan);
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [visible, query, activeNoteId]);

  useEffect(() => {
    if (!visible || !ranges.length) return;
    CSS.highlights.set("note-find", new Highlight(...ranges));
    CSS.highlights.set("note-find-active", new Highlight(ranges[index]!));
    if (reveal.current) {
      const range = ranges[index]!;
      const rect = range.getBoundingClientRect();
      const page = document.querySelector<HTMLElement>("#main-content [data-note-scroll]");
      if (page && rect.height) {
        const viewport = page.getBoundingClientRect();
        // The find bar floats over the page's top; a match counts as hidden under it.
        const top = Math.max(
          viewport.top,
          document.querySelector("[data-note-find-bar]")?.getBoundingClientRect().bottom ?? 0,
        );
        if (rect.top < top + 8 || rect.bottom > viewport.bottom - 8)
          page.scrollTop += rect.top - (top + (viewport.bottom - top) / 2);
        reveal.current = false;
      }
    }
    return () => {
      CSS.highlights.delete("note-find");
      CSS.highlights.delete("note-find-active");
    };
  }, [index, ranges, visible]);

  const close = () => {
    setTarget(null);
    if (previousFocus.current?.isConnected) previousFocus.current.focus();
    else document.getElementById("main-content")?.focus();
  };
  const move = (direction: number) => {
    if (!ranges.length) return;
    reveal.current = true;
    setIndex((current) => (current + direction + ranges.length) % ranges.length);
  };
  if (!visible) return null;
  return (
    <div
      data-note-find-bar
      // Floats under the header's right end, over the page, like a browser's find bar.
      className="absolute top-[calc(var(--loam-titlebar-height)+8px)] right-4 z-40 flex h-10 items-center gap-1.5 rounded-lg border border-(--app-border) bg-(--app-page) px-1.5 shadow-(--app-shadow-elevated)"
      role="search"
      aria-label="Find in note"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        const direction = matchesShortcut(event.nativeEvent, shortcuts["find.next"])
          ? 1
          : matchesShortcut(event.nativeEvent, shortcuts["find.previous"])
            ? -1
            : 0;
        if (direction) {
          event.preventDefault();
          move(direction);
        }
      }}
    >
      <SearchField
        surface="plain"
        icon={false}
        className="h-7 w-[min(260px,40vw)] rounded-(--radius-control) border border-(--app-border) bg-(--app-surface) pr-0.5 pl-2 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-(--app-focus-ring)"
        inputClassName="text-[13px] text-(--app-text)"
        ref={input}
        label="Find in note"
        placeholder="Find in this tab"
        exitOnCommitKeys={false}
        value={query}
        onChange={(value) => {
          setTarget({ noteId: activeNoteId!, query: value });
          setIndex(0);
          reveal.current = true;
        }}
      />
      <span
        className="min-w-19 text-center text-[12px] text-(--app-muted)"
        role="status"
        aria-live="polite"
      >
        {query.trim() ? (ranges.length ? `${index + 1} of ${ranges.length}` : "No matches") : ""}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Previous match"
        title={`Previous match (${formatShortcut("find.previous")})`}
        disabled={!ranges.length}
        onClick={() => move(-1)}
      >
        <ChevronUpIcon className="size-4" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Next match"
        title={`Next match (${formatShortcut("find.next")})`}
        disabled={!ranges.length}
        onClick={() => move(1)}
      >
        <ChevronDownIcon className="size-4" aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Close find" onClick={close}>
        <XIcon className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

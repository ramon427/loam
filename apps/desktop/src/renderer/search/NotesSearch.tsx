import { useDeferredValue, useId, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import { callBridge } from "../bridge";
import { formatShortcut } from "../keyboard/shortcuts";
import { useNotesWorkspace } from "../workspace/NotesWorkspace";
import { cn } from "../ui/cn";
import { SearchField } from "../ui/SearchField";
import { sidebarSearchClassName, sidebarSearchInputClassName } from "../ui/SidebarRow";
import type { NoteContentSearchResult } from "@loam/shared/notes/noteModel";

const SEARCH_PAGE_SIZE = 20;

const resultButtonClass =
  "flex w-full flex-col gap-0.5 rounded-[6px] border-0 bg-transparent px-2 py-1.5 text-left text-(--app-text) hover:bg-(--app-page-2) focus-visible:bg-(--app-page-2)";

const resultNoteClass = "px-2 py-1.5 text-[12px] leading-[1.4] text-(--app-muted)";

/** A search snippet with its match highlighted. */
function SearchSnippet({ snippet }: { snippet: NoteContentSearchResult["snippet"] }) {
  const { text, matchStart, matchLength } = snippet;
  if (matchLength <= 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, matchStart)}
      <mark className="rounded-[2px] bg-[var(--app-search-match-bg,color-mix(in_srgb,var(--app-accent)_28%,transparent))] text-[var(--app-search-match-foreground,inherit)]">
        {text.slice(matchStart, matchStart + matchLength)}
      </mark>
      {text.slice(matchStart + matchLength)}
    </>
  );
}

/** Search stays available after opening a result, so comparing matches takes no retyping. */
export function NotesSearch({
  onOpen,
  onFind,
}: {
  onOpen: () => void;
  /** Finds `query` in the note just opened. */
  onFind: (noteId: string, query: string) => void;
}) {
  const { openNote } = useNotesWorkspace();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const deferredQuery = useDeferredValue(query.trim());
  const search = useInfiniteQuery({
    queryKey: ["note-content-search", deferredQuery],
    queryFn: ({ pageParam }) =>
      callBridge("notes.search", {
        query: deferredQuery,
        limit: SEARCH_PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.hasMore ? pages.reduce((count, page) => count + page.results.length, 0) : undefined,
    enabled: deferredQuery.length > 0,
    staleTime: 0,
  });
  const results = deferredQuery ? (search.data?.pages.flatMap((page) => page.results) ?? []) : [];
  const ready = deferredQuery === query.trim();
  const expanded = showResults && query.trim().length > 0;

  const open = (result: NoteContentSearchResult) => {
    if (!ready) return;
    onOpen();
    openNote(result.noteId, { tabId: result.tabId });
    onFind(result.noteId, result.matchText ?? deferredQuery.split(/\s+/)[0]!);
    setShowResults(false);
  };
  const select = (index: number) => {
    const next = Math.max(0, Math.min(index, results.length - 1));
    setSelectedIndex(next);
    setShowResults(true);
    resultsRef.current
      ?.querySelectorAll("[data-search-result]")
      .item(next)
      ?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div
      className="relative min-w-0 flex-1"
      role="search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setShowResults(false);
      }}
    >
      <SearchField
        surface="plain"
        className={sidebarSearchClassName}
        inputClassName={sidebarSearchInputClassName}
        id="notes-search-input"
        ref={inputRef}
        title={`Search all notes (${formatShortcut("app.notes.search")})`}
        value={query}
        placeholder="Search"
        label="Search notes"
        clearLabel="Clear search"
        exitOnCommitKeys={false}
        aria-controls={listId}
        aria-expanded={expanded}
        aria-activedescendant={
          expanded && selectedIndex >= 0 ? `${listId}-${selectedIndex}` : undefined
        }
        onFocus={() => setShowResults(true)}
        onChange={(value) => {
          setQuery(value);
          setSelectedIndex(-1);
          setShowResults(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setShowResults(false);
            return;
          }
          if (!ready || !results.length) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            select(selectedIndex + 1);
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            select(selectedIndex < 0 ? results.length - 1 : selectedIndex - 1);
          }
          if (event.key === "Enter") {
            event.preventDefault();
            open(results[selectedIndex >= 0 ? selectedIndex : 0]!);
          }
        }}
      />
      {expanded ? (
        <ul
          id={listId}
          ref={resultsRef}
          className="absolute inset-x-0 top-[calc(100%+4px)] z-30 m-0 flex max-h-[min(60vh,480px)] w-[calc(var(--loam-sidebar-width,280px)-17px)] max-w-[calc(100vw-32px)] list-none flex-col gap-0.5 overflow-auto rounded-(--radius-control) border border-(--app-border) bg-(--app-surface) p-1 shadow-[0_12px_32px_rgb(0_0_0/18%)]"
          aria-label="Search results"
        >
          {ready
            ? results.map((result, index) => (
                <li key={result.noteId}>
                  <button
                    id={`${listId}-${index}`}
                    data-search-result
                    type="button"
                    className={cn(
                      resultButtonClass,
                      index === selectedIndex && "bg-(--app-page-2)",
                    )}
                    onClick={() => open(result)}
                    onFocus={() => setSelectedIndex(index)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        inputRef.current?.focus();
                        select(index + (event.key === "ArrowDown" ? 1 : -1));
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        inputRef.current?.focus();
                        setShowResults(false);
                      }
                    }}
                  >
                    <span className="text-[13px] font-semibold">{result.title || "Untitled"}</span>
                    {result.snippet.text ? (
                      <span className="text-[12px] leading-[1.4] text-(--app-muted)">
                        <SearchSnippet snippet={result.snippet} />
                      </span>
                    ) : null}
                  </button>
                </li>
              ))
            : null}
          {!ready || search.isPending ? (
            <li className={resultNoteClass} role="status">
              Searching…
            </li>
          ) : null}
          {ready && search.isError ? (
            <li className={resultNoteClass} role="alert">
              Search could not finish.{" "}
              <button
                type="button"
                className={resultButtonClass}
                onClick={() => void search.refetch()}
              >
                Try again
              </button>
            </li>
          ) : null}
          {ready && search.isSuccess && results.length === 0 ? (
            <li className={resultNoteClass} role="status">
              No notes match “{deferredQuery}”.
            </li>
          ) : null}
          {ready && search.hasNextPage ? (
            <li>
              <button
                type="button"
                className={resultButtonClass}
                disabled={search.isFetchingNextPage}
                onClick={() => void search.fetchNextPage()}
              >
                {search.isFetchingNextPage ? "Loading more…" : "Show more results"}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

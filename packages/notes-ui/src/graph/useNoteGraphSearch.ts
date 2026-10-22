import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";

import {
  filterNoteGraphNodeIds,
  isNoteGraphFilterActive,
  searchNoteGraphNodes,
  type NoteGraphFilter,
} from "./noteGraphQuery";
import type { NoteGraph } from "@loam/shared/notes/noteModel";

/**
 * Find in graph: a text search that steps through matches, plus filters that dim the nodes
 * that do not match. Closing the panel clears both.
 */
export function useNoteGraphSearch({
  graph,
  inputRef,
  showNode,
  focusPane,
}: {
  graph: NoteGraph;
  /** The search field, focused when the panel opens. */
  inputRef: RefObject<HTMLInputElement | null>;
  /** Reveals and selects a match. */
  showNode: (nodeId: string) => void;
  focusPane: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [filters, setFilters] = useState<NoteGraphFilter>({});

  const matches = useMemo(() => searchNoteGraphNodes(graph.nodes, query), [graph.nodes, query]);
  const filtersActive = isNoteGraphFilterActive(filters);
  const filteredOutIds = useMemo(() => {
    if (!filtersActive) return new Set<string>();
    const kept = filterNoteGraphNodeIds(graph.nodes, graph.edges, filters);
    return new Set(graph.nodes.filter((node) => !kept.has(node.id)).map((node) => node.id));
  }, [filters, filtersActive, graph.edges, graph.nodes]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [inputRef, open]);

  const openSearch = useCallback(() => {
    setOpen(true);
    inputRef.current?.focus();
  }, [inputRef]);

  const closeSearch = useCallback(() => {
    setOpen(false);
    setQueryState("");
    setFilters({});
    focusPane();
  }, [focusPane]);

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setMatchIndex(0);
  }, []);

  const cycleMatch = useCallback(
    (direction: 1 | -1) => {
      if (matches.length === 0) return;
      const next = (matchIndex + direction + matches.length) % matches.length;
      setMatchIndex(next);
      showNode(matches[next]!);
    },
    [matchIndex, matches, showNode],
  );

  return {
    open,
    query,
    matches,
    matchIndex,
    filters,
    filtersActive,
    filteredOutIds,
    openSearch,
    closeSearch,
    setQuery,
    setFilters,
    cycleMatch,
  };
}

export type NoteGraphSearch = ReturnType<typeof useNoteGraphSearch>;

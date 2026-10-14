import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";

import {
  areTypedTabValuesEqual,
  useTypedTabHistory,
  type TabHistoryCommands,
} from "../note/useTypedTabHistory";

import { resolveNoteGraphViewPreferences, type NoteGraphViewPreferences } from "./noteGraph";
import { useValueStore } from "./useValueStore";
import type { NoteGraph } from "@loam/shared/notes/noteModel";

const VIEWPORT_PUBLISH_DELAY_MS = 250;
const RECENT_PUBLISH_LIMIT = 20;

/** The undoable part of a graph: everything except the viewport and view preferences. */
const graphContent = (graph: NoteGraph) => ({
  ...graph,
  viewport: null,
  grid: null,
  snap: null,
  scrollMode: null,
  theme: null,
});

const isSameContent = (left: NoteGraph, right: NoteGraph) =>
  left === right || areTypedTabValuesEqual(graphContent(left), graphContent(right));

/**
 * Owns the graph the canvas edits. Edits apply synchronously, so a handler that makes
 * several changes builds each on the last, and every committed edit is one undo step that is
 * published to the note at once. The `graph` prop is adopted when it changes for a reason
 * other than an echo of something published here (an AI edit, a sync, a salvaged heading).
 */
export function useNoteGraphDocument({
  identity,
  graph: incomingGraph,
  onUpdateGraph,
  historyBridgeRef,
}: {
  /** Undo history restarts when this changes (another note or tab). */
  identity: string;
  graph: NoteGraph;
  onUpdateGraph: (graph: NoteGraph) => void;
  historyBridgeRef?: MutableRefObject<TabHistoryCommands | null>;
}) {
  const [graph, store] = useValueStore(() => incomingGraph);
  const recentPublishesRef = useRef<NoteGraph[]>([]);
  const adoptedGraphRef = useRef(incomingGraph);
  const viewportTimerRef = useRef<number | null>(null);

  const publish = useCallback(
    (next: NoteGraph) => {
      store.set(next);
      recentPublishesRef.current = [...recentPublishesRef.current, next].slice(
        -RECENT_PUBLISH_LIMIT,
      );
      onUpdateGraph(next);
    },
    [onUpdateGraph, store],
  );

  // Undo and redo restore older graphs; view preferences are not part of history, so the
  // current ones carry forward.
  const publishFromHistory = useCallback(
    (next: NoteGraph) => publish({ ...next, ...resolveNoteGraphViewPreferences(store.get()) }),
    [publish, store],
  );

  const history = useTypedTabHistory({
    identity,
    value: incomingGraph,
    onCommit: publishFromHistory,
    bridgeRef: historyBridgeRef,
    isLocalEcho: isSameContent,
  });

  useLayoutEffect(() => {
    if (adoptedGraphRef.current === incomingGraph) return;
    adoptedGraphRef.current = incomingGraph;
    const echo = recentPublishesRef.current.some((published) =>
      isSameContent(published, incomingGraph),
    );
    if (!echo) store.set(incomingGraph);
  }, [incomingGraph, store]);

  useEffect(
    () => () => {
      if (viewportTimerRef.current !== null) window.clearTimeout(viewportTimerRef.current);
    },
    [],
  );

  /** Commits an edit as one undo step. */
  const commit = useCallback(
    (next: NoteGraph, historyGroup?: string) => {
      if (next === store.get()) return;
      // History skips a graph equal to its own current one; the canvas still shows it.
      if (!history.commit(next, historyGroup)) store.set(next);
    },
    [history, store],
  );

  /** Grid, snap, scroll and theme changes are saved but not undoable. */
  const updateViewPreferences = useCallback(
    (patch: Partial<NoteGraphViewPreferences>) => publish({ ...store.get(), ...patch }),
    [publish, store],
  );

  /** Keeps the viewport right away and saves it once panning or zooming settles. */
  const persistViewport = useCallback(
    (viewport: NonNullable<NoteGraph["viewport"]>) => {
      store.set({ ...store.get(), viewport });
      if (viewportTimerRef.current !== null) window.clearTimeout(viewportTimerRef.current);
      viewportTimerRef.current = window.setTimeout(() => {
        viewportTimerRef.current = null;
        publish(store.get());
      }, VIEWPORT_PUBLISH_DELAY_MS);
    },
    [publish, store],
  );

  return {
    graph,
    getGraph: store.get,
    commit,
    updateViewPreferences,
    persistViewport,
    history,
  };
}

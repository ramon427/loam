import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { snapshotContextSelection } from "../action-menu/ActionMenu";

import {
  isNoteSelectionKey,
  noteSelectionKey,
  notesTreeRowHeight,
  treeSelectionKey,
  type NotesTreeItem,
  type NotesTreeRow,
} from "./notesTreeModel";

type Rect = { left: number; top: number; right: number; bottom: number };

type Marquee = {
  pointerId: number;
  additive: boolean;
  baseKeys: string[];
  /** Row boxes in client coordinates, fixed when the drag starts. */
  items: (Rect & { id: string })[];
  bounds: DOMRect;
  origin: { x: number; y: number };
  current: { x: number; y: number };
  isDragging: boolean;
};

const isMarqueeExcludedTarget = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(
    target.closest(
      'button, a[href], input, textarea, select, [contenteditable="true"], [role="textbox"], [role="button"], [role="link"], [data-tree-selection-key]',
    ),
  );

/** How far the pointer moves before a press on empty space becomes a marquee drag. */
const MARQUEE_DRAG_THRESHOLD = 4;

const sameKeys = (left: ReadonlySet<string>, right: ReadonlySet<string>) =>
  left.size === right.size && [...left].every((key) => right.has(key));

const toggleKey = (selection: ReadonlySet<string>, key: string) => {
  const next = new Set(selection);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

/** The keys from `anchorKey` to `targetKey` in shown order, or the target alone. */
const keyRange = (orderedKeys: readonly string[], anchorKey: string, targetKey: string) => {
  const anchorIndex = orderedKeys.indexOf(anchorKey);
  const targetIndex = orderedKeys.indexOf(targetKey);
  if (anchorIndex < 0 || targetIndex < 0) return new Set([targetKey]);
  return new Set(
    orderedKeys.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1),
  );
};

/** The rows a marquee touches, added to `baseKeys`. */
const keysUnder = (
  rect: Rect,
  items: readonly (Rect & { id: string })[],
  baseKeys: readonly string[],
) => {
  const next = new Set(baseKeys);
  for (const item of items)
    if (
      rect.left <= item.right &&
      rect.right >= item.left &&
      rect.top <= item.bottom &&
      rect.bottom >= item.top
    )
      next.add(item.id);
  return next;
};

const marqueeRect = ({ origin, current }: Marquee) => ({
  left: Math.min(origin.x, current.x),
  top: Math.min(origin.y, current.y),
  right: Math.max(origin.x, current.x),
  bottom: Math.max(origin.y, current.y),
});

const rowBoxes = (rows: readonly NotesTreeRow[], bounds: DOMRect, scrollTop: number) => {
  let top = bounds.top - scrollTop;
  return rows.flatMap((row) => {
    const box = {
      left: bounds.left,
      top,
      right: bounds.right,
      bottom: top + notesTreeRowHeight(row),
    };
    top = box.bottom;
    return row.kind === "note" || row.kind === "folder" ? [{ id: row.key, ...box }] : [];
  });
};

/**
 * Which tree items are selected: by click (with Shift for a range and Ctrl/Cmd to add),
 * by a right click, or by dragging a rectangle over empty tree space. With nothing else
 * selected, the selection follows the open note.
 */
export function useNotesTreeSelection({
  rows,
  visibleKeys,
  scopeKeys,
  activeNoteId,
  onSelectNote,
}: {
  rows: readonly NotesTreeRow[];
  /** Keys of the shown rows, in order. */
  visibleKeys: readonly string[];
  /** Keys of every item in scope; anything else drops out of the selection. */
  scopeKeys: ReadonlySet<string>;
  activeNoteId: string | null;
  onSelectNote: (noteId: string) => void;
}) {
  const activeKey = activeNoteId ? noteSelectionKey(activeNoteId) : null;
  const [requested, setRequested] = useState<ReadonlySet<string>>(
    () => new Set(activeKey ? [activeKey] : []),
  );
  const anchorRef = useRef<string | null>(activeKey);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const marqueeRef = useRef<Marquee | null>(null);
  const paintFrameRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (paintFrameRef.current !== null) cancelAnimationFrame(paintFrameRef.current);
    },
    [],
  );

  const selected = useMemo(() => {
    const inScope = new Set([...requested].filter((key) => scopeKeys.has(key)));
    // An empty selection, or a single note, follows the note that is open.
    const followsActive =
      activeKey !== null &&
      scopeKeys.has(activeKey) &&
      (inScope.size === 0 || (inScope.size === 1 && isNoteSelectionKey([...inScope][0]!)));
    return followsActive ? new Set([activeKey]) : inScope;
  }, [activeKey, requested, scopeKeys]);

  const resolveAnchor = (fallback: string) => {
    if (activeKey && selected.size === 1 && selected.has(activeKey)) return activeKey;
    const anchor = anchorRef.current;
    return anchor && visibleKeys.includes(anchor) ? anchor : fallback;
  };

  /** Applies a click to the selection; true when it was a plain click (open or toggle). */
  const click = (item: NotesTreeItem, event: ReactMouseEvent) => {
    const key = treeSelectionKey(item);
    if (event.shiftKey) {
      const anchor = resolveAnchor(key);
      if (anchor === key) anchorRef.current = key;
      setRequested(keyRange(visibleKeys, anchor, key));
      return false;
    }
    anchorRef.current = key;
    if (event.metaKey || event.ctrlKey) {
      setRequested(toggleKey(selected, key));
      return false;
    }
    setRequested(new Set([key]));
    return true;
  };

  const selectNote = (noteId: string, event: ReactMouseEvent) => {
    const item = { kind: "note", id: noteId } as const;
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      click(item, event);
      return;
    }
    onSelectNote(noteId);
    click(item, event);
  };

  /**
   * For a right-click: selects an unselected row, and returns the keys a menu should act on,
   * the row's or the whole selection it belongs to (none on empty space).
   */
  const selectForContextMenu = (target: EventTarget) => {
    const key =
      target instanceof Element
        ? target.closest<HTMLElement>("[data-tree-selection-key]")?.dataset.treeSelectionKey
        : undefined;
    if (!key) return [];
    const snapshot = snapshotContextSelection(selected, key);
    if (!selected.has(key)) {
      setRequested(new Set(snapshot.ids));
      anchorRef.current = key;
    }
    return snapshot.ids;
  };

  // The marquee is drawn once per frame, however often the pointer moves.
  const updateMarquee = (next: Marquee | null) => {
    marqueeRef.current = next;
    if (paintFrameRef.current !== null) cancelAnimationFrame(paintFrameRef.current);
    paintFrameRef.current = requestAnimationFrame(() => {
      paintFrameRef.current = null;
      setMarquee(next);
    });
  };

  const marqueeProps = {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button > 0 || isMarqueeExcludedTarget(event.target)) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const point = { x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      updateMarquee({
        pointerId: event.pointerId,
        additive: event.metaKey || event.ctrlKey,
        baseKeys: [...selected],
        items: rowBoxes(rows, bounds, event.currentTarget.scrollTop),
        bounds,
        origin: point,
        current: point,
        isDragging: false,
      });
      event.preventDefault();
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const current = marqueeRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const point = { x: event.clientX, y: event.clientY };
      const next = {
        ...current,
        current: point,
        isDragging:
          current.isDragging ||
          Math.hypot(point.x - current.origin.x, point.y - current.origin.y) >
            MARQUEE_DRAG_THRESHOLD,
      };
      updateMarquee(next);
      if (!next.isDragging) return;
      const hit = keysUnder(marqueeRect(next), next.items, next.additive ? next.baseKeys : []);
      if (!sameKeys(selected, hit)) setRequested(hit);
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => finishMarquee(event),
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => finishMarquee(event),
  };

  const finishMarquee = (event: ReactPointerEvent<HTMLElement>) => {
    const current = marqueeRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.isDragging) {
      const hit = keysUnder(
        marqueeRect(current),
        current.items,
        current.additive ? current.baseKeys : [],
      );
      setRequested(hit);
      anchorRef.current = visibleKeys.find((key) => hit.has(key)) ?? null;
    } else {
      // A click on empty space clears the selection (Ctrl/Cmd keeps it).
      setRequested(new Set(current.additive ? current.baseKeys : []));
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    updateMarquee(null);
  };

  const marqueeStyle: CSSProperties | undefined = marquee?.isDragging
    ? (() => {
        const rect = marqueeRect(marquee);
        return {
          left: rect.left - marquee.bounds.left,
          top: rect.top - marquee.bounds.top,
          width: rect.right - rect.left,
          height: rect.bottom - rect.top,
        };
      })()
    : undefined;

  return {
    selected,
    click,
    selectNote,
    selectAll: () => setRequested(new Set(visibleKeys)),
    selectForContextMenu,
    marqueeProps,
    marqueeStyle,
  };
}

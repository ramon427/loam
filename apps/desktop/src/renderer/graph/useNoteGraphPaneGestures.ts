import { useCallback, useEffect, useRef } from "react";

type Point = { x: number; y: number };

const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP_PX = 10;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_SLOP_PX = 28;

// React Flow renders nodes, edges and edge labels inside its pane element, so "inside the
// pane" alone does not mean the gesture hit empty canvas.
const contentSelector =
  ".react-flow__node, .react-flow__edge, .react-flow__edgelabel-renderer, .react-flow__edgeupdater";

const isEmptyCanvas = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(target.closest(".react-flow__pane")) &&
  !target.closest(contentSelector);

/**
 * Gestures on empty canvas: double-click or double-tap starts a text there, and on touch a long
 * press switches dragging to rectangle selection until empty canvas is tapped again. Also
 * remembers the last pointer position, where pasted nodes land.
 */
export function useNoteGraphPaneGestures({
  readOnly,
  touchMarquee,
  screenToFlow,
  writeTextAt,
  startTouchMarquee,
  endTouchMarquee,
  focusPane,
}: {
  readOnly: boolean;
  touchMarquee: boolean;
  screenToFlow: (point: Point) => Point | null;
  /** Starts a text object at a flow point, ready to type into. */
  writeTextAt: (point: Point) => void;
  startTouchMarquee: () => void;
  endTouchMarquee: () => void;
  focusPane: () => void;
}) {
  const lastPointerRef = useRef<Point | null>(null);
  const lastTapRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const longPressRef = useRef<{ timer: number; x: number; y: number } | null>(null);

  const cancelLongPress = useCallback(() => {
    if (longPressRef.current) window.clearTimeout(longPressRef.current.timer);
    longPressRef.current = null;
  }, []);
  useEffect(() => cancelLongPress, [cancelLongPress]);

  const createAtClientPoint = useCallback(
    (x: number, y: number) => {
      if (readOnly) return;
      writeTextAt(screenToFlow({ x, y }) ?? { x: 120, y: 120 });
    },
    [writeTextAt, readOnly, screenToFlow],
  );

  const onDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (isEmptyCanvas(event.target)) createAtClientPoint(event.clientX, event.clientY);
    },
    [createAtClientPoint],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      lastPointerRef.current = screenToFlow({ x: event.clientX, y: event.clientY });
      const press = longPressRef.current;
      if (
        press &&
        Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_SLOP_PX
      ) {
        cancelLongPress();
      }
    },
    [cancelLongPress, screenToFlow],
  );

  const onPointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Portalled menus bubble through the graph, but must keep their own focus.
      if (!(event.target instanceof Element) || !event.target.closest(".react-flow")) return;
      focusPane();
      if (event.pointerType !== "touch" || readOnly || touchMarquee) return;
      if (!isEmptyCanvas(event.target)) return;
      cancelLongPress();
      longPressRef.current = {
        x: event.clientX,
        y: event.clientY,
        timer: window.setTimeout(() => {
          longPressRef.current = null;
          startTouchMarquee();
        }, LONG_PRESS_MS),
      };
    },
    [cancelLongPress, focusPane, readOnly, startTouchMarquee, touchMarquee],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      cancelLongPress();
      if (event.pointerType !== "touch") return;
      if (touchMarquee) {
        if (event.target instanceof Element && event.target.closest(".react-flow__pane")) {
          endTouchMarquee();
        }
        return;
      }
      if (!isEmptyCanvas(event.target)) return;
      const now = Date.now();
      const last = lastTapRef.current;
      lastTapRef.current = { at: now, x: event.clientX, y: event.clientY };
      if (
        last &&
        now - last.at < DOUBLE_TAP_MS &&
        Math.hypot(event.clientX - last.x, event.clientY - last.y) < DOUBLE_TAP_SLOP_PX
      ) {
        lastTapRef.current = null;
        createAtClientPoint(event.clientX, event.clientY);
      }
    },
    [cancelLongPress, createAtClientPoint, endTouchMarquee, touchMarquee],
  );

  return {
    /** The flow point under the pointer when it last moved over the canvas. */
    getLastPointer: useCallback(() => lastPointerRef.current, []),
    paneProps: { onDoubleClick, onPointerDownCapture, onPointerMove, onPointerUp },
  };
}

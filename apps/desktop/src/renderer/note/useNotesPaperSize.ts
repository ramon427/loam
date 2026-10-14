import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { matchesShortcut, shortcuts } from "../keyboard/shortcuts";
import { asNumber, readPreference, writePreference } from "../lib/preferences";
import { clamp } from "../lib/clamp";

const PAPER_SIZE_KEY = "note-paper-size:v1";
const A4_SIZE = { width: 860, height: 1216 };
const MIN_WIDTH = 360;
const MAX_WIDTH = 1600;
const MIN_HEIGHT = 480;
const MAX_HEIGHT = 3000;

type PaperSize = typeof A4_SIZE;
type ResizeAxis = "width" | "both";
type PaperDrag = {
  axis: ResizeAxis;
  pointerId: number;
  target: HTMLElement;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  originalSize: PaperSize;
};

const clampToPixel = (value: number, min: number, max: number) =>
  Math.round(clamp(value, min, max));

const readSize = (): PaperSize =>
  readPreference(PAPER_SIZE_KEY, (saved) => {
    if (!saved || typeof saved !== "object") return null;
    const { width, height } = saved as Record<string, unknown>;
    const savedWidth = asNumber(width);
    const savedHeight = asNumber(height);
    return {
      width: savedWidth === null ? A4_SIZE.width : clampToPixel(savedWidth, MIN_WIDTH, MAX_WIDTH),
      height:
        savedHeight === null ? A4_SIZE.height : clampToPixel(savedHeight, MIN_HEIGHT, MAX_HEIGHT),
    };
  }) ?? A4_SIZE;

const persistSize = (size: PaperSize) => writePreference(PAPER_SIZE_KEY, size);

const sameSize = (left: PaperSize, right: PaperSize) =>
  left.width === right.width && left.height === right.height;

/** The sizes before (undo) and after (redo) the current one, newest last. */
type SizeHistory = { undo: PaperSize[]; redo: PaperSize[] };

/** A preferred sheet size; smaller windows constrain its width without changing it. */
export function useNotesPaperSize(enabled: boolean) {
  const [size, setSize] = useState(readSize);
  const sizeRef = useRef(size);
  /** The size last saved; each saved change can be undone from a handle. */
  const savedRef = useRef(size);
  const [history, setHistory] = useState<SizeHistory>({ undo: [], redo: [] });
  const [availableWidth, setAvailableWidth] = useState(MAX_WIDTH);
  const availableWidthRef = useRef(MAX_WIDTH);
  const paperRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<PaperDrag | null>(null);
  const [resizeAxis, setResizeAxis] = useState<ResizeAxis | null>(null);
  const maximumWidth = Math.min(MAX_WIDTH, availableWidth);
  const minimumWidth = Math.min(MIN_WIDTH, maximumWidth);
  const width = Math.min(size.width, maximumWidth);

  const bindSizeCanvas = useCallback(
    (canvas: HTMLDivElement | null) => {
      if (!canvas || !enabled) return;
      const measure = () => {
        if (!canvas.clientWidth) return;
        const style = getComputedStyle(canvas);
        const next = Math.max(
          1,
          Math.floor(
            canvas.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
          ),
        );
        availableWidthRef.current = next;
        setAvailableWidth(next);
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(canvas);
      return () => observer.disconnect();
    },
    [enabled],
  );

  const save = useCallback((next: PaperSize) => {
    const saved = savedRef.current;
    if (sameSize(saved, next)) return;
    savedRef.current = next;
    persistSize(next);
    setHistory((current) => ({ undo: [...current.undo, saved], redo: [] }));
  }, []);

  const updateSize = useCallback(
    (next: PaperSize, persist: boolean) => {
      sizeRef.current = next;
      setSize(next);
      if (persist) save(next);
    },
    [save],
  );

  /** Shows the size before (undo) or after (redo) the saved one. */
  const step = (direction: keyof SizeHistory) => {
    const next = history[direction].at(-1);
    if (!next) return;
    const saved = savedRef.current;
    savedRef.current = next;
    sizeRef.current = next;
    setSize(next);
    persistSize(next);
    setHistory((current) =>
      direction === "undo"
        ? { undo: current.undo.slice(0, -1), redo: [...current.redo, saved] }
        : { undo: [...current.undo, saved], redo: current.redo.slice(0, -1) },
    );
  };

  const resizeTo = useCallback(
    (next: Partial<PaperSize>, persist: boolean) => {
      const maxWidth = Math.min(MAX_WIDTH, availableWidthRef.current);
      updateSize(
        {
          width:
            next.width === undefined
              ? sizeRef.current.width
              : clampToPixel(next.width, Math.min(MIN_WIDTH, maxWidth), maxWidth),
          height:
            next.height === undefined
              ? sizeRef.current.height
              : clampToPixel(next.height, MIN_HEIGHT, MAX_HEIGHT),
        },
        persist,
      );
    },
    [updateSize],
  );

  const finishResize = useCallback(
    (cancel = false) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      setResizeAxis(null);
      if (cancel) updateSize(drag.originalSize, false);
      else save(sizeRef.current);
      if (drag.target.hasPointerCapture(drag.pointerId))
        drag.target.releasePointerCapture(drag.pointerId);
    },
    [save, updateSize],
  );

  useEffect(() => {
    if (!enabled) finishResize();
    const finish = () => finishResize();
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("blur", finish);
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      save(sizeRef.current);
      if (drag.target.hasPointerCapture(drag.pointerId))
        drag.target.releasePointerCapture(drag.pointerId);
    };
  }, [enabled, finishResize, save]);

  const resetSize = () => {
    finishResize();
    updateSize(A4_SIZE, true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, axis: ResizeAxis) => {
    const amount = event.shiftKey ? 50 : 10;
    // A focused handle undoes the paper's size, not the note's last edit.
    if (matchesShortcut(event.nativeEvent, shortcuts["edit.undo"])) step("undo");
    else if (matchesShortcut(event.nativeEvent, shortcuts["edit.redo"])) step("redo");
    else if (event.key === "Escape" && dragRef.current) finishResize(true);
    else if (event.key === "Home" || event.key === "Enter") resetSize();
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight")
      resizeTo({ width: width + (event.key === "ArrowRight" ? amount : -amount) }, true);
    else if (axis === "both" && (event.key === "ArrowUp" || event.key === "ArrowDown"))
      resizeTo({ height: size.height + (event.key === "ArrowDown" ? amount : -amount) }, true);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const startResize = (event: PointerEvent<HTMLElement>, axis: ResizeAxis) => {
    if (event.button !== 0 || event.isPrimary === false || !paperRef.current) return;
    event.preventDefault();
    finishResize();
    const target = event.currentTarget;
    const rect = paperRef.current.getBoundingClientRect();
    target.focus({ preventScroll: true });
    target.setPointerCapture(event.pointerId);
    dragRef.current = {
      axis,
      pointerId: event.pointerId,
      target,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      originalSize: sizeRef.current,
    };
    setResizeAxis(axis);
  };

  const sharedHandleProps = {
    onDoubleClick: resetSize,
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      resizeTo(
        {
          // The sheet stays centered, so each edge moves by half the width change.
          width: drag.startWidth + 2 * (event.clientX - drag.startX),
          height:
            drag.axis === "both"
              ? drag.startHeight + event.clientY - drag.startY
              : drag.originalSize.height,
        },
        false,
      );
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (dragRef.current?.pointerId === event.pointerId) finishResize();
    },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => {
      if (dragRef.current?.pointerId === event.pointerId) finishResize(true);
    },
    onLostPointerCapture: () => finishResize(),
  };

  return {
    paperRef,
    bindSizeCanvas,
    resizeAxis,
    /** For the handles' right-click menu. */
    sizeActions: {
      canUndo: history.undo.length > 0,
      undo: () => step("undo"),
      isDefault: sameSize(size, A4_SIZE),
      reset: resetSize,
    },
    paperStyle: {
      "--notes-document-width": `${size.width}px`,
      "--notes-document-height": `${size.height}px`,
    } as CSSProperties,
    widthHandleProps: {
      ...sharedHandleProps,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => onKeyDown(event, "width"),
      onPointerDown: (event: PointerEvent<HTMLElement>) => startResize(event, "width"),
      role: "separator",
      tabIndex: 0,
      "aria-label": "Resize paper width",
      "aria-orientation": "vertical" as const,
      "aria-valuemin": minimumWidth,
      "aria-valuemax": maximumWidth,
      "aria-valuenow": width,
      "aria-valuetext": `${width} pixels`,
      title: "Drag to resize paper width. Double-click to restore A4 size.",
    },
    cornerHandleProps: {
      ...sharedHandleProps,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => onKeyDown(event, "both"),
      onPointerDown: (event: PointerEvent<HTMLElement>) => startResize(event, "both"),
      "aria-label": "Resize paper",
      title: "Drag to resize paper width and height. Double-click to restore A4 size.",
    },
  };
}

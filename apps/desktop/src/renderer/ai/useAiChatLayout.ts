import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { asNumber, readPreference, writePreference } from "../lib/preferences";
import { clamp } from "../lib/clamp";

/** The side chat's column, by its element id. */
export const PANEL_ID = "ai-chat-panel";
const CHAT_LAYOUT_KEY = "ai-chat-layout:v1";
const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
/** The note keeps at least this much of the window beside the sidebar and the chat. */
const MIN_NOTE_WIDTH = 420;

type ChatLayout = { open: boolean; preferredWidth: number };
type ResizeDrag = {
  pointerId: number;
  target: HTMLDivElement;
  startX: number;
  startWidth: number;
  preferredWidth: number;
};

const readLayout = (): ChatLayout =>
  readPreference(CHAT_LAYOUT_KEY, (saved) => {
    if (!saved || typeof saved !== "object") return null;
    const { open, preferredWidth } = saved as Record<string, unknown>;
    const width = asNumber(preferredWidth);
    return {
      open: open === true,
      preferredWidth:
        width === null ? DEFAULT_WIDTH : Math.round(clamp(width, MIN_WIDTH, MAX_WIDTH)),
    };
  }) ?? { open: false, preferredWidth: DEFAULT_WIDTH };

const persistLayout = (layout: ChatLayout) => writePreference(CHAT_LAYOUT_KEY, layout);

const subscribeToWindowResize = (listener: () => void) => {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
};
const readViewportWidth = () => window.innerWidth;
const readServerViewportWidth = () => 1280;

/**
 * Whether the side chat is open and how wide it is, kept across restarts.
 * `besideWidth` is what the sidebar takes, so the note keeps its room.
 */
export function useAiChatLayout(besideWidth: number) {
  const [layout, setLayout] = useState(readLayout);
  const layoutRef = useRef(layout);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<ResizeDrag | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const viewportWidth = useSyncExternalStore(
    subscribeToWindowResize,
    readViewportWidth,
    readServerViewportWidth,
  );
  const maximumWidth = Math.max(
    MIN_WIDTH,
    Math.min(MAX_WIDTH, viewportWidth - besideWidth - MIN_NOTE_WIDTH),
  );
  const clampWidth = useCallback(
    (width: number) => Math.round(clamp(width, MIN_WIDTH, maximumWidth)),
    [maximumWidth],
  );
  const width = clampWidth(layout.preferredWidth);

  const updateLayout = useCallback((next: ChatLayout, persist: boolean) => {
    layoutRef.current = next;
    setLayout(next);
    if (persist) persistLayout(next);
  }, []);

  const resizeTo = (nextWidth: number, persist: boolean) =>
    updateLayout({ ...layoutRef.current, preferredWidth: clampWidth(nextWidth) }, persist);

  const finishResize = useCallback(
    (cancel = false) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      setResizing(false);
      if (cancel)
        updateLayout({ ...layoutRef.current, preferredWidth: drag.preferredWidth }, false);
      else persistLayout(layoutRef.current);
      if (drag.target.hasPointerCapture(drag.pointerId))
        drag.target.releasePointerCapture(drag.pointerId);
    },
    [updateLayout],
  );

  useEffect(() => {
    const finish = () => finishResize();
    window.addEventListener("blur", finish);
    return () => window.removeEventListener("blur", finish);
  }, [finishResize]);

  const open = useCallback(() => {
    if (!layoutRef.current.open) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      updateLayout({ ...layoutRef.current, open: true }, true);
    }
    // The composer is there once the panel renders.
    requestAnimationFrame(() =>
      document
        .getElementById(PANEL_ID)
        ?.querySelector<HTMLElement>("textarea")
        ?.focus({ preventScroll: true }),
    );
  }, [updateLayout]);

  /** Closes the chat; focus inside it goes back to where it was before it opened. */
  const close = useCallback(() => {
    finishResize();
    const hadFocus = Boolean(document.getElementById(PANEL_ID)?.contains(document.activeElement));
    updateLayout({ ...layoutRef.current, open: false }, true);
    if (!hadFocus) return;
    requestAnimationFrame(() => {
      const previous = previousFocusRef.current;
      if (previous?.isConnected && previous.getClientRects().length > 0)
        previous.focus({ preventScroll: true });
      else document.getElementById("main-content")?.focus({ preventScroll: true });
    });
  }, [finishResize, updateLayout]);

  const toggle = useCallback(() => (layoutRef.current.open ? close() : open()), [close, open]);

  const onResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 50 : 10;
    switch (event.key) {
      case "ArrowLeft":
        resizeTo(width + step, true);
        break;
      case "ArrowRight":
        resizeTo(width - step, true);
        break;
      case "Home":
        resizeTo(MIN_WIDTH, true);
        break;
      case "End":
        resizeTo(maximumWidth, true);
        break;
      case "Enter":
        close();
        break;
      case "Escape":
        if (!dragRef.current) return;
        finishResize(true);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    open: layout.open,
    width,
    resizing,
    openPanel: open,
    close,
    toggle,
    resizeHandleProps: {
      role: "separator",
      tabIndex: 0,
      "aria-label": "Resize side chat",
      "aria-controls": PANEL_ID,
      "aria-orientation": "vertical" as const,
      "aria-valuemin": MIN_WIDTH,
      "aria-valuemax": maximumWidth,
      "aria-valuenow": width,
      "aria-valuetext": `${width} pixels`,
      title: "Drag to resize the side chat. Double-click to reset its width.",
      onKeyDown: onResizeKeyDown,
      onDoubleClick: () => {
        finishResize();
        updateLayout({ ...layoutRef.current, preferredWidth: DEFAULT_WIDTH }, true);
      },
      onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || event.isPrimary === false) return;
        event.preventDefault();
        finishResize();
        const target = event.currentTarget;
        target.focus({ preventScroll: true });
        target.setPointerCapture(event.pointerId);
        dragRef.current = {
          pointerId: event.pointerId,
          target,
          startX: event.clientX,
          startWidth: width,
          preferredWidth: layoutRef.current.preferredWidth,
        };
        setResizing(true);
      },
      onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (drag && drag.pointerId === event.pointerId)
          resizeTo(drag.startWidth - (event.clientX - drag.startX), false);
      },
      onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pointerId === event.pointerId) finishResize();
      },
      onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pointerId === event.pointerId) finishResize(true);
      },
      onLostPointerCapture: () => finishResize(),
    },
  };
}

export type AiChatLayout = ReturnType<typeof useAiChatLayout>;

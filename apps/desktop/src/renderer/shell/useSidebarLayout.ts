import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { asNumber, readPreference, writePreference } from "../lib/preferences";
import { clamp } from "../lib/clamp";

const SIDEBAR_LAYOUT_KEY = "sidebar-layout:v1";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 220;
const MAX_WIDTH = 480;
const MIN_CONTENT_WIDTH = 320;

type SidebarLayout = { collapsed: boolean; preferredWidth: number };
type ResizeDrag = {
  pointerId: number;
  target: HTMLDivElement;
  startX: number;
  startWidth: number;
  preferredWidth: number;
};

const readLayout = (): SidebarLayout =>
  readPreference(SIDEBAR_LAYOUT_KEY, (saved) => {
    if (!saved || typeof saved !== "object") return null;
    const { collapsed, preferredWidth } = saved as Record<string, unknown>;
    const width = asNumber(preferredWidth);
    return {
      collapsed: collapsed === true,
      preferredWidth:
        width === null ? DEFAULT_WIDTH : Math.round(clamp(width, MIN_WIDTH, MAX_WIDTH)),
    };
  }) ?? { collapsed: false, preferredWidth: DEFAULT_WIDTH };

const persistLayout = (layout: SidebarLayout) => writePreference(SIDEBAR_LAYOUT_KEY, layout);

const maximumWidth = (viewportWidth: number) =>
  Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, viewportWidth - MIN_CONTENT_WIDTH));
const clampWidth = (width: number, viewportWidth: number) =>
  Math.round(clamp(width, MIN_WIDTH, maximumWidth(viewportWidth)));
const subscribeToWindowResize = (listener: () => void) => {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
};
const readViewportWidth = () => window.innerWidth;
const readServerViewportWidth = () => 1280;

/** Keeps the preferred width when a smaller window temporarily constrains the sidebar. */
export function useSidebarLayout() {
  const [layout, setLayout] = useState(readLayout);
  const layoutRef = useRef(layout);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<ResizeDrag | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const resizeRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const viewportWidth = useSyncExternalStore(
    subscribeToWindowResize,
    readViewportWidth,
    readServerViewportWidth,
  );
  const width = clampWidth(layout.preferredWidth, viewportWidth);

  const updateLayout = useCallback((next: SidebarLayout, persist: boolean) => {
    layoutRef.current = next;
    setLayout(next);
    if (persist) persistLayout(next);
  }, []);

  const resizeTo = useCallback(
    (nextWidth: number, persist: boolean) => {
      updateLayout(
        { ...layoutRef.current, preferredWidth: clampWidth(nextWidth, window.innerWidth) },
        persist,
      );
    },
    [updateLayout],
  );

  const finishResize = useCallback(
    (cancel = false) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      setResizing(false);
      if (cancel) {
        updateLayout({ ...layoutRef.current, preferredWidth: drag.preferredWidth }, false);
      } else {
        persistLayout(layoutRef.current);
      }
      if (drag.target.hasPointerCapture(drag.pointerId))
        drag.target.releasePointerCapture(drag.pointerId);
    },
    [updateLayout],
  );

  useEffect(() => {
    const finish = () => finishResize();
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("blur", finish);
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      persistLayout(layoutRef.current);
      if (drag.target.hasPointerCapture(drag.pointerId))
        drag.target.releasePointerCapture(drag.pointerId);
    };
  }, [finishResize]);

  const toggle = useCallback(() => {
    finishResize();
    const next = { ...layoutRef.current, collapsed: !layoutRef.current.collapsed };
    if (
      next.collapsed &&
      (sidebarRef.current?.contains(document.activeElement) ||
        resizeRef.current === document.activeElement)
    )
      toggleRef.current?.focus({ preventScroll: true });
    updateLayout(next, true);
  }, [finishResize, updateLayout]);

  const resetWidth = useCallback(() => {
    finishResize();
    updateLayout({ ...layoutRef.current, preferredWidth: DEFAULT_WIDTH }, true);
  }, [finishResize, updateLayout]);

  const onResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 50 : 10;
    switch (event.key) {
      case "ArrowLeft":
        resizeTo(width - step, true);
        break;
      case "ArrowRight":
        resizeTo(width + step, true);
        break;
      case "Home":
        resizeTo(MIN_WIDTH, true);
        break;
      case "End":
        resizeTo(maximumWidth(viewportWidth), true);
        break;
      case "Enter":
        toggle();
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
    collapsed: layout.collapsed,
    /** What the sidebar takes of the window: 0 while collapsed. */
    width: layout.collapsed ? 0 : width,
    resizing,
    sidebarRef,
    resizeRef,
    toggleRef,
    toggle,
    style: { "--loam-sidebar-width": `${layout.collapsed ? 0 : width}px` } as CSSProperties,
    resizeHandleProps: {
      hidden: layout.collapsed,
      role: "separator",
      tabIndex: layout.collapsed ? -1 : 0,
      "aria-label": "Resize sidebar",
      "aria-controls": "notes-sidebar",
      "aria-describedby": "sidebar-resize-hint",
      "aria-orientation": "vertical" as const,
      "aria-valuemin": MIN_WIDTH,
      "aria-valuemax": maximumWidth(viewportWidth),
      "aria-valuenow": width,
      "aria-valuetext": `${width} pixels`,
      onKeyDown: onResizeKeyDown,
      onDoubleClick: resetWidth,
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
          resizeTo(drag.startWidth + event.clientX - drag.startX, false);
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

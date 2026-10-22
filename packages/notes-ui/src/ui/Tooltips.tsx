import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "./cn";
import styles from "./tooltips.module.css";
import { clamp } from "../lib/clamp";

/** How long the pointer rests on a control before its tooltip shows. */
const SHOW_DELAY_MS = 400;
/** Moving on to another control this soon after a tooltip closed shows its tooltip at once. */
const SKIP_DELAY_MS = 400;
/** The gap between a control and its tooltip, and the least room it keeps from the window's edges. */
const GAP_PX = 4;
const EDGE_PX = 5;

/** Elements that can have a tooltip: a title, a tooltip of its own, or an icon-only control. */
const TOOLTIP_SOURCES =
  "[title], [data-tooltip], button[aria-label], [role='button'][aria-label], a[href][aria-label]";

/**
 * The text `element` shows as its tooltip, or null. A `title` becomes the
 * element's tooltip, so the browser's own doesn't show too; it stays the
 * element's description for assistive technology. An icon-only control shows
 * its name, which nothing on screen says.
 */
const tooltipOf = (element: Element): string | null => {
  // A frame's title names it; it never showed as a tooltip.
  if (element.closest("[data-no-tooltip], iframe")) return null;
  const title = element.getAttribute("title");
  if (title) {
    element.removeAttribute("title");
    element.setAttribute("data-tooltip", title);
    if (title !== element.getAttribute("aria-label"))
      element.setAttribute("aria-description", title);
  }
  // A field shows its own placeholder or text, so a tooltip only covers what is below it.
  if (element.matches("input, textarea, select, [contenteditable='true']")) return null;
  const tooltip = element.getAttribute("data-tooltip");
  // A label that shows in full already says what its tooltip would.
  if (tooltip && element.textContent?.trim() === tooltip.trim() && !isCutOff(element)) return null;
  if (tooltip) return tooltip;
  const label = element.getAttribute("aria-label");
  return label && !element.textContent?.trim() ? label : null;
};

/** Whether text in `element` is cut off, as a truncated label is. */
const isCutOff = (element: Element) =>
  [element, ...element.querySelectorAll("*")].some(
    (node) => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1,
  );

/** Where the window's titlebar ends, which a tooltip doesn't cover. */
const titlebarBottom = () =>
  document.querySelector(".loam-chrome-row")?.getBoundingClientRect().bottom ?? 0;

type Shown = { text: string; anchor: DOMRect };

/**
 * The app's tooltips, in its own look instead of the browser's: one layer
 * for every control, shown after a short rest of the pointer or when the
 * keyboard focuses a control, and gone on a press, a scroll or Escape.
 */
export function Tooltips() {
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    let current: Element | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closedAt = 0;
    // A tooltip that is showing follows its control's text, such as a download's progress.
    const changes = new MutationObserver(() => {
      const text = current ? tooltipOf(current) : null;
      if (current && text) setShown({ text, anchor: current.getBoundingClientRect() });
    });

    const hide = () => {
      clearTimeout(timer);
      changes.disconnect();
      if (current) closedAt = Date.now();
      current = null;
      setShown(null);
    };
    const showFor = (element: Element | null) => {
      if (element === current) return;
      const text = element ? tooltipOf(element) : null;
      hide();
      if (!element || !text) return;
      current = element;
      const delay = Date.now() - closedAt < SKIP_DELAY_MS ? 0 : SHOW_DELAY_MS;
      timer = setTimeout(() => {
        // A control whose menu or popover is open shows that instead.
        if (!element.isConnected || element.getAttribute("aria-expanded") === "true") return;
        setShown({ text, anchor: element.getBoundingClientRect() });
        changes.observe(element, {
          attributes: true,
          attributeFilter: ["title", "aria-label", "data-tooltip"],
        });
      }, delay);
    };
    const sourceOf = (target: EventTarget | null) =>
      target instanceof Element ? target.closest(TOOLTIP_SOURCES) : null;

    const over = (event: PointerEvent) => {
      if (event.pointerType !== "touch") showFor(sourceOf(event.target));
    };
    const out = (event: PointerEvent) => {
      if (!event.relatedTarget) hide();
    };
    const focusIn = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.matches(":focus-visible"))
        showFor(sourceOf(event.target));
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusin", focusIn, true);
    document.addEventListener("focusout", hide, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("wheel", hide, { capture: true, passive: true });
    return () => {
      clearTimeout(timer);
      changes.disconnect();
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("focusin", focusIn, true);
      document.removeEventListener("focusout", hide, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("wheel", hide, true);
    };
  }, []);

  return shown ? createPortal(<Tooltip {...shown} />, document.body) : null;
}

/**
 * A tooltip above its control and centred on it, clear of the pointer;
 * below when there is no room above, such as for controls in the titlebar,
 * and kept inside the window. It settles in from a little smaller.
 */
function Tooltip({ text, anchor }: Shown) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number; below: boolean } | null>(null);

  useLayoutEffect(() => {
    const { width, height } = ref.current!.getBoundingClientRect();
    const above = anchor.top - GAP_PX - height;
    const below = above < Math.max(EDGE_PX, titlebarBottom() + EDGE_PX);
    const top = below ? anchor.bottom + GAP_PX : above;
    const centred = anchor.left + anchor.width / 2 - width / 2;
    const left = clamp(centred, EDGE_PX, window.innerWidth - width - EDGE_PX);
    setPlace({ left, top: Math.min(top, window.innerHeight - height - EDGE_PX), below });
  }, [anchor, text]);

  return (
    <div
      ref={ref}
      role="tooltip"
      data-side={place?.below ? "bottom" : "top"}
      style={
        place
          ? {
              left: place.left,
              top: place.top,
              // It grows from the side nearest its control.
              transformOrigin: `${anchor.left + anchor.width / 2 - place.left}px ${place.below ? "0" : "100%"}`,
            }
          : { left: 0, top: 0, visibility: "hidden" }
      }
      className={cn(
        "pointer-events-none fixed z-[140] max-w-80 rounded-[7px] border border-(--raised-panel-border) surface-glass surface-glass-thick [--glass-tint:var(--app-surface-overlay)] px-2 py-1 text-xs leading-snug dark:[--glass-tint:#2e2e2e] text-balance break-words text-(--app-text) shadow-md",
        place && styles.enter,
      )}
    >
      {text}
    </div>
  );
}

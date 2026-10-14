import { useCallback } from "react";

const SCROLLING_ATTRIBUTE = "data-notes-scrolling";
/** How long after the last scroll event the element still counts as scrolling. */
export const SCROLL_IDLE_MS = 150;

/**
 * Marks an element with `data-notes-scrolling` while it or any of its
 * ancestors scrolls, so the stylesheet can drop costly paint, such as the
 * paper's shadow, until scrolling stops. Returns the element's ref callback.
 */
export const useMarkWhileScrolling = <T extends HTMLElement>(enabled = true) =>
  useCallback(
    (element: T | null) => {
      if (!enabled || !element) return;
      let idleTimer: number | undefined;
      const onScroll = () => {
        if (!element.hasAttribute(SCROLLING_ATTRIBUTE))
          element.setAttribute(SCROLLING_ATTRIBUTE, "true");
        window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(
          () => element.removeAttribute(SCROLLING_ATTRIBUTE),
          SCROLL_IDLE_MS,
        );
      };
      // Every ancestor listens: one can start scrolling after this binds.
      const scrollers: Array<HTMLElement | Window> = [window];
      for (let node: HTMLElement | null = element; node; node = node.parentElement)
        scrollers.push(node);
      for (const scroller of scrollers)
        scroller.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        window.clearTimeout(idleTimer);
        for (const scroller of scrollers) scroller.removeEventListener("scroll", onScroll);
        element.removeAttribute(SCROLLING_ATTRIBUTE);
      };
    },
    [enabled],
  );

import { useCallback, useEffect, useRef, useState } from "react";

/** How far from the bottom, in pixels, still counts as reading the latest. */
const FOLLOW_THRESHOLD_PX = 48;

/**
 * Keeps a scrolling list at its newest content while the reader is there:
 * as an answer streams in, the list stays at the bottom. Scrolling up stops
 * following and offers a way back; reaching the bottom again follows again.
 */
export function useFollowLatest() {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLOListElement | null>(null);
  const following = useRef(true);
  const [behind, setBehind] = useState(false);

  const toBottom = useCallback(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, []);

  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    toBottom();
    // Content grows without scrolling as text streams in; following keeps up with it.
    const grows = new ResizeObserver(() => {
      if (following.current) toBottom();
      else setBehind(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 1);
    });
    grows.observe(content);
    return () => grows.disconnect();
  }, [toBottom]);

  const onScroll = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    following.current = distance < FOLLOW_THRESHOLD_PX;
    setBehind(!following.current);
  }, []);

  const backToLatest = useCallback(() => {
    following.current = true;
    setBehind(false);
    toBottom();
  }, [toBottom]);

  return { scrollRef, contentRef, onScroll, behind, backToLatest };
}

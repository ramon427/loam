import { useEffect, useRef } from "react";

import { mountedEditorDom, type NoteBlockEditor } from "./noteEditorSchema";

/** Brings a block into view, such as a heading opened from a graph node. */
export type BlockRevealRequest = {
  id: number;
  blockId: string;
  /** The block that takes the cursor, when it isn't `blockId`. */
  cursorBlockId?: string;
  /** Marks the block for a moment, as following a heading link does. */
  highlight?: boolean;
};

/** Shows a requested block once its element exists, and puts the cursor there. */
export function useBlockReveal(editor: NoteBlockEditor, reveal: BlockRevealRequest | null) {
  const shownReveal = useRef<number | null>(null);
  useEffect(() => {
    if (!reveal || shownReveal.current === reveal.id) return;
    let frame = 0;
    let attempts = 0;
    let unmark: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      const element = Array.from(
        mountedEditorDom(editor)?.querySelectorAll<HTMLElement>("[data-id]") ?? [],
      ).find((candidate) => candidate.dataset.id === reveal.blockId);
      if (!element) {
        if (++attempts < 12) frame = requestAnimationFrame(show);
        return;
      }
      shownReveal.current = reveal.id;
      try {
        editor.setTextCursorPosition(reveal.cursorBlockId ?? reveal.blockId, "start");
        editor.focus();
      } catch {
        // The block can change between the request and the editor showing it.
      }
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      element.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
      if (!reveal.highlight) return;
      element.dataset.noteHeadingHighlight = "true";
      unmark = setTimeout(() => delete element.dataset.noteHeadingHighlight, reduced ? 900 : 1600);
    };
    frame = requestAnimationFrame(show);
    return () => {
      cancelAnimationFrame(frame);
      if (unmark) clearTimeout(unmark);
    };
  }, [editor, reveal]);
}

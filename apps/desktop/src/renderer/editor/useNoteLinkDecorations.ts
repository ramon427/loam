import { useEffect } from "react";

import { mountedEditorDom, type NoteBlockEditor } from "./noteEditorSchema";
import { decorateNoteLinks } from "./noteMentionDecoration";
import type { NoteLinkCandidate } from "./noteMentions";

/**
 * Note links show their note's title and whether it still exists; timestamps, whether there
 * is a video and which one is playing. They are marked again after each change.
 */
export function useNoteLinkDecorations(
  editor: NoteBlockEditor,
  {
    hasVideo,
    currentVideoTimestamp,
    readLinkCandidates,
  }: {
    hasVideo: boolean;
    currentVideoTimestamp: number | null;
    readLinkCandidates: () => readonly NoteLinkCandidate[];
  },
) {
  useEffect(() => {
    let frame: number | null = null;
    const decorate = () => {
      frame = null;
      const dom = mountedEditorDom(editor);
      if (dom)
        decorateNoteLinks(dom, {
          hasVideo,
          currentVideoTimestamp,
          readLinkCandidates,
        });
    };
    const schedule = () => {
      frame ??= requestAnimationFrame(decorate);
    };
    const stopMount = editor.onMount(schedule);
    const stopChange = editor.onChange(schedule);
    schedule();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      stopMount();
      stopChange();
    };
  }, [currentVideoTimestamp, editor, hasVideo, readLinkCandidates]);
}

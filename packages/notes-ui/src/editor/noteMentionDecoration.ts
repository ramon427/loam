import { readVideoTimestampHref } from "@loam/shared/notes/noteLinks";

import { readNoteLinkNoteId } from "./editorLinks";
import { getNoteLinkTitle, type NoteLinkCandidate } from "./noteMentions";

const setAttribute = (anchor: HTMLAnchorElement, name: string, value: string) => {
  // ProseMirror observes attribute changes; write only real ones.
  if (anchor.getAttribute(name) !== value) anchor.setAttribute(name, value);
};

/**
 * Marks the in-app links under `root` for the editor stylesheet
 * (`.noteMentionsRoot`): links to notes, broken once the library no longer
 * has the note, and video timestamps, broken while the note has no video and
 * current while their part of the video plays. An empty library is unknown,
 * not proof that a note is gone.
 */
export const decorateNoteLinks = (
  root: ParentNode,
  {
    hasVideo,
    currentVideoTimestamp = null,
    readLinkCandidates,
  }: {
    hasVideo: boolean;
    currentVideoTimestamp?: number | null;
    readLinkCandidates: () => readonly NoteLinkCandidate[];
  },
) => {
  let titles: Map<string, string> | null = null;
  let libraryKnown = false;
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = anchor.getAttribute("href") ?? "";
    const seconds = readVideoTimestampHref(href);
    if (seconds !== null) {
      setAttribute(anchor, "data-note-mention", "video-timestamp");
      setAttribute(anchor, "data-note-mention-broken", String(!hasVideo));
      setAttribute(anchor, "data-note-video-current", String(seconds === currentVideoTimestamp));
      if (anchor.hasAttribute("title")) anchor.removeAttribute("title");
      continue;
    }
    const noteId = readNoteLinkNoteId(href);
    if (!noteId) continue;
    if (!titles) {
      const candidates = readLinkCandidates();
      libraryKnown = candidates.length > 0;
      titles = new Map(candidates.map((candidate) => [candidate.id, candidate.title]));
    }
    const known = titles.has(noteId);
    const broken = libraryKnown && !known;
    setAttribute(anchor, "data-note-mention", "note");
    setAttribute(anchor, "data-note-mention-broken", String(broken));
    setAttribute(
      anchor,
      "title",
      broken
        ? "This note no longer exists"
        : `Open ${known ? getNoteLinkTitle(titles.get(noteId)) : "note"}`,
    );
  }
};

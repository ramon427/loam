import { parseVideoTimestamp } from "./noteVideo";

/*
 * Links in a note that lead somewhere in the app rather than to the web. Notes
 * store these hrefs, so their formats don't change:
 * - another note: `/notes?noteId=<id>`
 * - a moment in the note's video: `#note-video?t=<seconds>`. The editor once
 *   wrote `#note-ref?kind=video-timestamp&seconds=<seconds>`, which still reads.
 */

const NOTE_HREF_PREFIX = "/notes?";
const UNSAFE_NOTE_ID = /[\u0000-\u001F\u007F�]/;

export const buildNoteHref = (noteId: string) =>
  `${NOTE_HREF_PREFIX}noteId=${encodeURIComponent(noteId)}`;

/**
 * The note a link points at, or null for any other href. A full URL counts
 * only on `appOrigin`, the renderer's own origin.
 */
export const readNoteHrefNoteId = (href: string | null | undefined, appOrigin?: string) => {
  let path = href?.trim() ?? "";
  if (appOrigin && path.startsWith(`${appOrigin}/`)) path = path.slice(appOrigin.length);
  if (!path.startsWith(NOTE_HREF_PREFIX)) return null;
  const query = path.slice(NOTE_HREF_PREFIX.length).split("#")[0];
  const noteId = new URLSearchParams(query).get("noteId")?.trim();
  return noteId && !UNSAFE_NOTE_ID.test(noteId) ? noteId : null;
};

// BlockNote's own rule for the links an editor keeps; @blocknote/core does not export it.
const BLOCKNOTE_ALLOWED_URI =
  /^(?:(?:http|https|ftp|ftps|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z0-9+.-]+(?:[^a-z+.:-]|$))/i;

/**
 * Whether an editor keeps a link with this href: BlockNote's rule, plus the
 * app's own `loam-` schemes (its window origin and the importer's placeholder
 * links), which that rule drops.
 */
export const isEditorLink = (href: string) => {
  const cleaned = href.replace(/\s/g, "");
  return cleaned.startsWith("loam-") || BLOCKNOTE_ALLOWED_URI.test(cleaned);
};

export const buildVideoTimestampHref = (seconds: number) =>
  `#note-video?t=${Math.max(0, Math.floor(seconds))}`;

/** The second of the note's video a link points at, or null for any other href. */
export const readVideoTimestampHref = (href: string): number | null => {
  const link = href.trim();
  const params = (prefix: string) =>
    link.startsWith(`${prefix}?`) ? new URLSearchParams(link.slice(prefix.length + 1)) : null;
  const video = params("#note-video");
  if (video) return parseVideoTimestamp(video.get("t"));
  const reference = params("#note-ref");
  if (reference?.get("kind") !== "video-timestamp") return null;
  const seconds = Number(reference.get("seconds") ?? Number.NaN);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : null;
};

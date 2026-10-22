import type { BlockNoteEditor } from "@blocknote/core";

import { readNoteHrefNoteId, readVideoTimestampHref } from "@loam/shared/notes/noteLinks";

import type { NoteDocument } from "../workspace/types";
import { selectVideoTimestampLink } from "./noteVideoTimestampEditing";

/** The note a link in the editor points at; a link may also hold the window's full URL. */
export const readNoteLinkNoteId = (href: string | null | undefined) =>
  readNoteHrefNoteId(href, window.location.origin);

/**
 * Where a link in a note leads inside the app: another note, or a moment in
 * the note's video. `none` is a timestamp in a note that has no video.
 */
export type AppLinkTarget =
  { kind: "note"; noteId: string } | { kind: "video"; seconds: number } | { kind: "none" };

/** The in-app target of `href`, or null for a link to the web. */
export const resolveAppLink = (
  href: string,
  note: Pick<NoteDocument, "video">,
): AppLinkTarget | null => {
  const noteId = readNoteLinkNoteId(href);
  if (noteId) return { kind: "note", noteId };
  const seconds = readVideoTimestampHref(href);
  if (seconds === null) return null;
  return note.video ? { kind: "video", seconds } : { kind: "none" };
};

/**
 * BlockNote's link click handler while editing: a click on a timestamp
 * selects the whole timestamp instead of following it.
 */
export const handleEditorLinkClick = (event: MouseEvent, editor: BlockNoteEditor) => {
  const anchor =
    event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  const href = anchor?.getAttribute("href");
  if (!anchor || !href || readVideoTimestampHref(href) === null) return false;
  selectVideoTimestampLink(editor, anchor);
  return true;
};

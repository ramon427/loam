import { readVideoTimestampHref } from "@loam/shared/notes/noteLinks";
import { formatVideoTimestamp } from "@loam/shared/notes/noteVideo";
import { isRecord } from "@loam/shared/utils/isRecord";

import type { NoteDocument } from "../workspace/types";
import { tabKindOf } from "@loam/shared/notes/noteModel";

/** Another note the editor can link to, from the local notes library. */
export type NoteLinkCandidate = {
  id: string;
  title: string;
  folderName?: string | null;
};

/** What the `@` menu offers: a link to another note, or the video's current moment. */
export type NoteMentionMenuItem = {
  id: string;
  title: string;
  section: "Notes" | "Video";
  detail: string;
  score: number;
} & ({ noteId: string; seconds?: undefined } | { seconds: number; noteId?: undefined });

const MAX_NOTE_LINK_MENU_ITEMS = 8;

export const getNoteLinkTitle = (title: string | null | undefined) =>
  title?.trim() || "Untitled note";

/** How well `values` match what was typed after `@`: null for no match, higher for better. */
const matchScore = (values: Array<string | undefined>, query: string) => {
  const typed = query.trim().toLowerCase();
  if (!typed) return 0;
  const texts = values.flatMap((value) => (value ? [value.toLowerCase()] : []));
  if (texts.some((text) => text.startsWith(typed))) return 100;
  if (texts.some((text) => text.includes(typed))) return 70;
  return null;
};

export const buildNoteMentionMenuItems = (
  note: NoteDocument,
  query: string,
  linkCandidates: readonly NoteLinkCandidate[] = [],
): NoteMentionMenuItem[] => {
  const items: NoteMentionMenuItem[] = linkCandidates
    .flatMap((candidate): NoteMentionMenuItem[] => {
      if (candidate.id === note.id) return [];
      const title = getNoteLinkTitle(candidate.title);
      const score = matchScore([title], query);
      if (score === null) return [];
      const detail = candidate.folderName?.trim() || "Note";
      return [
        {
          id: `note:${candidate.id}`,
          title,
          section: "Notes",
          noteId: candidate.id,
          detail,
          score,
        },
      ];
    })
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, MAX_NOTE_LINK_MENU_ITEMS);

  const videoScore = note.video ? matchScore([note.video.title, "video timestamp"], query) : null;
  if (note.video && videoScore !== null) {
    const seconds = note.video.lastWatchedSeconds ?? 0;
    items.push({
      id: `video:${seconds}`,
      title: formatVideoTimestamp(seconds),
      section: "Video",
      seconds,
      detail: note.video.title || "Current timestamp",
      score: videoScore,
    });
  }

  return items.sort(
    (left, right) =>
      right.score - left.score ||
      left.section.localeCompare(right.section) ||
      left.title.localeCompare(right.title),
  );
};

/** The moment an inline item links to, or null when it isn't a timestamp link. */
const timestampOf = (value: Record<string, unknown>) =>
  value.type === "link" && typeof value.href === "string"
    ? readVideoTimestampHref(value.href)
    : null;

/** The text an inline item shows, without timestamp links. */
const inlineText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(inlineText).join("");
  if (!isRecord(value) || timestampOf(value) !== null) return "";
  if (typeof value.text === "string") return value.text;
  return inlineText(value.content);
};

/** Calls `visit` for every timestamp link in the blocks, at any depth, with its block's text. */
const forEachTimestamp = (value: unknown, visit: (seconds: number, text: string) => void) => {
  if (Array.isArray(value)) {
    for (const block of value) forEachTimestamp(block, visit);
    return;
  }
  if (!isRecord(value)) return;
  if (Array.isArray(value.content)) {
    const links = value.content.filter(isRecord).map(timestampOf);
    if (links.some((seconds) => seconds !== null)) {
      const text = inlineText(value.content).replace(/\s+/gu, " ").trim();
      for (const seconds of links) if (seconds !== null) visit(seconds, text);
    }
  }
  forEachTimestamp(value.children, visit);
};

/** A moment of the video the note links to, and the text of the first block that links to it. */
export type NoteVideoTimestamp = { seconds: number; text: string };

/** The moments of the video that the note's page tabs link to, in order. */
export const listNoteVideoTimestamps = (
  note: Pick<NoteDocument, "blocksByTab" | "tabs">,
): NoteVideoTimestamp[] => {
  const timestamps = new Map<number, string>();
  for (const tab of note.tabs)
    if (tabKindOf(tab) === "page")
      forEachTimestamp(note.blocksByTab[tab.id], (seconds, text) => {
        if (!timestamps.has(seconds)) timestamps.set(seconds, text);
      });
  return [...timestamps]
    .map(([seconds, text]) => ({ seconds, text }))
    .sort((left, right) => left.seconds - right.seconds);
};

/** The timestamp whose part of the video is playing at `seconds`: the last one at or before it. */
export const currentVideoTimestamp = (
  timestamps: readonly NoteVideoTimestamp[],
  seconds: number,
): NoteVideoTimestamp | null =>
  timestamps.findLast((timestamp) => timestamp.seconds <= seconds) ?? null;

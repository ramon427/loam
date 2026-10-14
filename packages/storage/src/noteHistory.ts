import type { NoteContent } from "@loam/shared/notes/noteModel";
import { stableJsonStringify } from "@loam/shared/utils/stableJson";

import type { StorageWrite } from "./adapter";
import { fnv1a } from "./fnv1a";

/**
 * Version history rules, kept apart from the store so they can be tested on
 * their own. A version is the content a note had before it was changed: one
 * is kept when a save replaces content last captured over ten minutes ago,
 * before a delete, and before a restore.
 */

export const HISTORY_CAPTURE_INTERVAL_MS = 10 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HISTORY_RETENTION = {
  allWithinMs: DAY_MS,
  hourlyWithinMs: 7 * DAY_MS,
  dailyWithinMs: 30 * DAY_MS,
  max: 100,
};

export type HistoryEntry = {
  /** The id of the `revisions` record holding this version. */
  id: string;
  /** When this content was saved. */
  savedAt: number;
  /** When it was kept as a version. */
  capturedAt: number;
  title: string;
  sizeBytes: number;
  contentHash: string;
};

/** The `history` record for one note, newest version first. */
export type HistoryIndex = { versions: HistoryEntry[] };

export type RevisionRecord = { noteId: string; savedAt: number; document: NoteContent };

const CONTENT_KEYS = [
  "title",
  "tabs",
  "blocksByTab",
  "graphsByTab",
  "tablesByTab",
  "graph",
  "video",
  "activeTabId",
] as const;

/**
 * Identifies what a note says: FNV-1a over stable JSON of exactly these
 * fields, absent ones as null. Stored versions keep this hash, and a new one
 * is compared with the newest, so it must stay the same across versions.
 */
const hashNoteContent = (document: NoteContent) => {
  const fields: Record<string, unknown> = Object.fromEntries(
    CONTENT_KEYS.map((key) => [key, document[key] ?? null]),
  );
  // These tabs came after this hash; a note without them keeps the hash it had.
  for (const key of ["textsByTab", "embedsByTab", "filesByTab"] as const)
    if (Object.keys(document[key] ?? {}).length > 0) fields[key] = document[key];
  return `fnv1a:${fnv1a(stableJsonStringify(fields)).toString(16).padStart(8, "0")}`;
};

/**
 * Which versions to keep, newest first: every one kept in the last day, then
 * the newest of each hour for a week, then of each day for a month, at most
 * 100. Ages count from when a version was kept, so the content an old note
 * had before today's edit is kept as long as any other version.
 */
export const selectVersionsToKeep = (versions: readonly HistoryEntry[], now: number) => {
  const sorted = [...versions].sort((left, right) => right.capturedAt - left.capturedAt);
  const keep: HistoryEntry[] = [];
  const buckets = new Set<string>();
  for (const version of sorted) {
    const age = now - version.capturedAt;
    if (age > HISTORY_RETENTION.dailyWithinMs) continue;
    if (age > HISTORY_RETENTION.allWithinMs) {
      const size = age > HISTORY_RETENTION.hourlyWithinMs ? DAY_MS : HOUR_MS;
      const bucket = `${size}:${Math.floor(version.capturedAt / size)}`;
      if (buckets.has(bucket)) continue;
      buckets.add(bucket);
    }
    keep.push(version);
    if (keep.length >= HISTORY_RETENTION.max) break;
  }
  return keep;
};

/**
 * Decides whether replacing `document` keeps it as a version, and returns the
 * new index plus the versions retention lets go. Null means nothing to keep.
 */
export const planHistoryCapture = ({
  index,
  document,
  savedAt,
  now,
  force,
  createId,
}: {
  index: HistoryIndex | null;
  /** The note's content (title included) that is about to be replaced. */
  document: NoteContent;
  /** When that content was saved. */
  savedAt: number;
  now: number;
  /** Keep the version even if one was kept moments ago (deletes and restores). */
  force: boolean;
  createId: () => string;
}) => {
  const versions = index?.versions ?? [];
  const newest = versions[0];
  const contentHash = hashNoteContent(document);
  // Nothing changed since the last version, so there's nothing new to keep.
  if (newest?.contentHash === contentHash) return null;
  if (!force && newest && now - newest.capturedAt < HISTORY_CAPTURE_INTERVAL_MS) return null;

  const entry: HistoryEntry = {
    id: createId(),
    savedAt,
    capturedAt: now,
    title: document.title,
    sizeBytes: Buffer.byteLength(JSON.stringify(document)),
    contentHash,
  };
  const kept = selectVersionsToKeep([entry, ...versions], now);
  const keptIds = new Set(kept.map((version) => version.id));
  return {
    entry,
    index: { versions: kept } satisfies HistoryIndex,
    removedIds: versions.filter((version) => !keptIds.has(version.id)).map((version) => version.id),
  };
};

/**
 * The writes that keep `document`, which note `noteId` is about to replace,
 * as a version: none when `planHistoryCapture` keeps nothing.
 */
export const versionWrites = (
  noteId: string,
  capture: Parameters<typeof planHistoryCapture>[0],
): StorageWrite[] => {
  const plan = planHistoryCapture(capture);
  if (!plan) return [];
  const revision: RevisionRecord = {
    noteId,
    savedAt: plan.entry.savedAt,
    document: capture.document,
  };
  return [
    { type: "put", collection: "revisions", id: plan.entry.id, value: revision },
    ...plan.removedIds.map((id): StorageWrite => ({ type: "delete", collection: "revisions", id })),
    { type: "put", collection: "history", id: noteId, value: plan.index },
  ];
};

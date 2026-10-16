import type { NoteContent, NoteFolder, NoteProject } from "@loam/shared/notes/noteModel";
import { isRecord } from "@loam/shared/utils/isRecord";
import { UUID_PATTERN } from "@loam/shared/utils/uuid";

import { normalizeFolderName } from "../folders";
import { readNoteContent, toPlacement, type NotePlacement } from "../noteContent";
import { readProjectFields } from "../projects";
import { isClock, isVersionVector, type Clock, type VersionVector } from "./clock";

/**
 * What sync exchanges. A note's content, its place in the library, each
 * folder and each project are separate documents, so moving a note never
 * conflicts with an edit to it, and two devices filing notes into folders
 * don't either. Places and folders name their project; those from versions
 * before projects have none. A sub-note's place names its parent note;
 * versions before sub-notes ignore it and show the note at the top level.
 */
export type SyncDocKind = "note" | "place" | "folder" | "project";
export type SyncDocKey = `${SyncDocKind}:${string}`;

export type PlaceValue = NotePlacement;
type FolderValue = Omit<NoteFolder, "id">;
type ProjectValue = Omit<NoteProject, "id">;

type SyncValues = {
  note: NoteContent;
  place: PlaceValue;
  folder: FolderValue;
  project: ProjectValue;
};

/** One version of one document, as a device publishes it. `value: null` means deleted. */
export type SyncChangeOf<K extends SyncDocKind> = {
  key: `${K}:${string}`;
  clock: Clock;
  vector: VersionVector;
  /** When the author saved it (ms); a note's "updated" time on other devices. */
  savedAt: number;
  /**
   * Clocks of versions this one won a conflict over on its author's device. Devices on older
   * versions don't write or read it.
   */
  overrode?: Clock[];
  value: SyncValues[K] | null;
};

/** A change to any document; its key's kind says what its value holds. */
export type SyncChange =
  SyncChangeOf<"note"> | SyncChangeOf<"place"> | SyncChangeOf<"folder"> | SyncChangeOf<"project">;

/** A change's identity, known from its file name before the file is read. */
export type SyncChangeRef = { key: SyncDocKey; clock: Clock };

export const syncKey = <K extends SyncDocKind>(kind: K, id: string): `${K}:${string}` =>
  `${kind}:${id}`;

export const parseSyncKey = (key: string): { kind: SyncDocKind; id: string } | null => {
  const separator = key.indexOf(":");
  const kind = key.slice(0, separator);
  const id = key.slice(separator + 1);
  if (
    (kind !== "note" && kind !== "place" && kind !== "folder" && kind !== "project") ||
    !UUID_PATTERN.test(id)
  )
    return null;
  return { kind, id };
};

/** Whether `change` is to a document of `kind`. */
export const isChangeOf = <K extends SyncDocKind>(
  change: SyncChange,
  kind: K,
): change is Extract<SyncChange, SyncChangeOf<K>> => change.key.startsWith(`${kind}:`);

const isPosition = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isId = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);

/** The project a place or folder names: an id, or none when it has none. */
const readProject = (value: unknown) =>
  value == null ? {} : isId(value) ? { projectId: value } : undefined;

/** Each kind's value from untrusted input; undefined when it isn't one. Null (deleted) is handled before. */
const readValue: { [K in SyncDocKind]: (value: unknown) => SyncValues[K] | undefined } = {
  note: (value) => {
    try {
      return readNoteContent(value);
    } catch {
      return undefined;
    }
  },
  place: (value) => {
    if (!isRecord(value) || !isPosition(value.position)) return undefined;
    const { folderId } = value;
    const project = readProject(value.projectId);
    if ((folderId !== null && !isId(folderId)) || !project) return undefined;
    // A parent another device names may not have arrived yet; the library shows the note at the top level till then.
    const parent = isId(value.parentNoteId) ? { parentNoteId: value.parentNoteId } : {};
    return toPlacement({ folderId, ...project, ...parent, position: value.position });
  },
  folder: (value) => {
    if (!isRecord(value) || !isPosition(value.position) || typeof value.name !== "string")
      return undefined;
    const project = readProject(value.projectId);
    if (!project) return undefined;
    return { name: normalizeFolderName(value.name), position: value.position, ...project };
  },
  project: (value) => {
    if (!isRecord(value) || !isPosition(value.position) || typeof value.name !== "string")
      return undefined;
    return readProjectFields(value.name, value.icon, value.position);
  },
};

const readChangeOf = <K extends SyncDocKind>(
  kind: K,
  id: string,
  fields: Omit<SyncChangeOf<K>, "key" | "value">,
  input: unknown,
): SyncChangeOf<K> | null => {
  const value = input === null ? null : readValue[kind](input);
  return value === undefined ? null : { ...fields, key: syncKey(kind, id), value };
};

/**
 * Checks a change read from another device. Anything in the sync folder is
 * untrusted: a change must name the document and clock its file name gave.
 */
export const readSyncChange = (input: unknown, expected: SyncChangeRef): SyncChange | null => {
  if (!isRecord(input)) return null;
  const { key, clock, vector, savedAt, overrode } = input;
  if (key !== expected.key || clock !== expected.clock || !isClock(clock)) return null;
  const parsed = parseSyncKey(expected.key);
  if (!parsed || !isVersionVector(vector) || vector[clock.slice(-8)] !== clock) return null;
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt) || savedAt < 0) return null;
  const { kind, id } = parsed;
  const lost = Array.isArray(overrode) ? overrode.filter(isClock).slice(-32) : [];
  const fields = { clock, vector, savedAt, ...(lost.length > 0 && { overrode: lost }) };
  if (kind === "note") return readChangeOf(kind, id, fields, input.value);
  if (kind === "place") return readChangeOf(kind, id, fields, input.value);
  if (kind === "folder") return readChangeOf(kind, id, fields, input.value);
  return readChangeOf(kind, id, fields, input.value);
};

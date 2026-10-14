import type { NoteGraphSnapshot } from "./noteModel";
import { isRecord } from "../utils/isRecord";

const clipboardPrefix = "loam-graph-snapshot:";
const maxCoordinate = 10_000_000;

const isId = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "" && value.length <= 200;

const isCoordinate = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= maxCoordinate;

/** Validate persisted or pasted references before passing their geometry to SVG. */
export const readNoteGraphSnapshot = (value: unknown): NoteGraphSnapshot | null => {
  if (!isRecord(value)) return null;
  const { noteId, tabId, x, y, width, height } = value;
  if (!isId(noteId) || !isId(tabId)) return null;
  if (!isCoordinate(x) || !isCoordinate(y) || !isCoordinate(width) || !isCoordinate(height)) {
    return null;
  }
  if (width <= 0 || height <= 0) return null;
  return { noteId, tabId, x, y, width, height };
};

export const encodeNoteGraphSnapshot = (snapshot: NoteGraphSnapshot) =>
  `${clipboardPrefix}${JSON.stringify(snapshot)}`;

/** Reads a snapshot from JSON text, such as the attribute an exported snapshot block carries. */
export const parseNoteGraphSnapshot = (json: string): NoteGraphSnapshot | null => {
  if (json.length > 2048) return null;
  try {
    return readNoteGraphSnapshot(JSON.parse(json));
  } catch {
    return null;
  }
};

export const decodeNoteGraphSnapshot = (text: string): NoteGraphSnapshot | null => {
  const value = text.trim();
  if (!value.startsWith(clipboardPrefix)) return null;
  return parseNoteGraphSnapshot(value.slice(clipboardPrefix.length));
};

export const noteGraphSnapshotRect = (
  start: { x: number; y: number },
  end: { x: number; y: number },
) => ({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y),
});

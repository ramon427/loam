import {
  buildMediaUrl,
  isLocalMediaImageUrl,
  readLocalMediaImagePath,
} from "@loam/shared/notes/mediaFiles";

import { configuredNotesHost } from "../host/notesHost";

const schemePattern = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;
const controlCharacterPattern = /[\u0000-\u001F\u007F]/;

const isStoredMediaPath = (value: string) =>
  value.length > 0 &&
  !schemePattern.test(value) &&
  !value.startsWith("/") &&
  !value.includes("\\") &&
  !controlCharacterPattern.test(value) &&
  value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");

/**
 * The media-folder path behind an image reference. Notes store paths
 * (`<uuid>.png`), but imported and MCP-written notes may hold the full
 * `loam-media://images/<file>` URL, so both are accepted.
 */
export const toMediaPath = (ref: string): string | null => {
  const trimmed = ref.trim();
  if (isLocalMediaImageUrl(trimmed)) return readLocalMediaImagePath(trimmed);
  return isStoredMediaPath(trimmed) ? trimmed : null;
};

/**
 * The URL an `<img>` (or BlockNote) should load for an image reference:
 * stored media maps to the host's media URL, https URLs pass through,
 * and anything else is null because the renderer can't load it.
 */
export const mediaSrc = (ref: string): string | null => {
  const path = toMediaPath(ref);
  if (path) return (configuredNotesHost()?.mediaUrl ?? buildMediaUrl)(path);
  const trimmed = ref.trim();
  return trimmed.startsWith("https://") && URL.canParse(trimmed) ? trimmed : null;
};

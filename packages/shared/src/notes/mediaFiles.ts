import { LOAM_MEDIA_PROTOCOL } from "../bridge/loamBridge";

/**
 * Stored images: the names the media folder gives them and the
 * `loam-media://images/<file>` URLs the window loads them from.
 */

const MEDIA_HOST = "images";
const controlCharacterPattern = /[\u0000-\u001F\u007F]/;

/** Saved images are named `<uuid>.<ext>`. */
export const MEDIA_FILE_NAME_PATTERN = /^[0-9a-f-]{36}\.(?:avif|gif|jpe?g|png|webp)$/;

/** File tabs' PDF and Word documents sit beside the images, named `<uuid>.<ext>`. */
export const isTabDocumentName = (name: string) => /^[0-9a-f-]{36}\.(?:pdf|docx)$/.test(name);

/** Whether the media folder saved a file under `name`; nothing else is ever read from it. */
export const isStoredMediaName = (name: string) =>
  MEDIA_FILE_NAME_PATTERN.test(name) || isTabDocumentName(name);

/** True for a path that stays inside the media folder: no `..`, backslash or control character. */
export const isSafeMediaPath = (value: string) =>
  !value.startsWith("/") &&
  !value.includes("\\") &&
  !value.split("/").some((segment) => segment === "..") &&
  !controlCharacterPattern.test(value);

/** The URL a stored image is served from. Each path segment is percent-encoded. */
export const buildMediaUrl = (path: string) =>
  `${LOAM_MEDIA_PROTOCOL}://${MEDIA_HOST}/${path.split("/").map(encodeURIComponent).join("/")}`;

/** True for `loam-media://images/<file>`, the URL the app serves stored images from. */
export const isLocalMediaImageUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === `${LOAM_MEDIA_PROTOCOL}:` && url.hostname === MEDIA_HOST;
  } catch {
    return false;
  }
};

/** The stored path behind a local media URL, or null for any other value or a malformed one. */
export const readLocalMediaImagePath = (value: string) => {
  if (!isLocalMediaImageUrl(value)) return null;
  try {
    const path = decodeURIComponent(new URL(value).pathname.replace(/^\/+/, ""));
    return path && isSafeMediaPath(path) ? path : null;
  } catch {
    return null;
  }
};

/**
 * The media file an image reference names, from a file name or a local media
 * URL, or null when it can't be one the media folder saved.
 */
export const readMediaFileName = (reference: string) => {
  const trimmed = reference.trim();
  const name = readLocalMediaImagePath(trimmed) ?? trimmed;
  return MEDIA_FILE_NAME_PATTERN.test(name) ? name : null;
};

/** Path helpers for imports. Paths are relative to what was picked and use `/`. */

const MAX_FOLDER_NAME_LENGTH = 120;
/** Files an import treats as images; their bytes decide whether one can be saved. */
const IMAGE_FILE_PATTERN = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;

export const isImageFilePath = (path: string) => IMAGE_FILE_PATTERN.test(path);

export const directoryOf = (path: string) => path.split("/").slice(0, -1).join("/");

export const fileNameOf = (path: string) => path.split("/").at(-1) ?? path;

/** Resolves `.` and `..` in a relative path; null when it climbs above the root. */
export const normalizePath = (path: string) => {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
};

/**
 * Loam folders are flat, so nested folders become one name: `Projects/2024`
 * becomes "Projects / 2024". `cleanSegment` can tidy each part first.
 */
export const folderNameFor = (path: string, cleanSegment = (segment: string) => segment) => {
  const directory = directoryOf(path);
  if (!directory) return null;
  const name = directory
    .split("/")
    .map((part) => cleanSegment(part).trim())
    .filter(Boolean)
    .join(" / ");
  return Array.from(name).slice(0, MAX_FOLDER_NAME_LENGTH).join("").trim() || null;
};

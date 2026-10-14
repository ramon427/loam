// Characters that are invalid on Windows or macOS, or that break Obsidian links.
const UNSAFE_CHARACTERS = /[\\/:*?"<>|#^[\]\u0000-\u001f\u007f]/g;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com\d|lpt\d)$/i;
const MAX_NAME_LENGTH = 100;

/** A file or folder name that is valid on Windows, macOS and Linux. */
export const toSafeFileName = (title: string, fallback = "Untitled") => {
  const cleaned = title.normalize("NFC").replace(UNSAFE_CHARACTERS, "-").replace(/\s+/g, " ");
  // Cut on whole characters so an emoji is never split in half. Trim after the
  // cut: leading dots hide files, and trailing dots and spaces are invalid on Windows.
  let name = Array.from(cleaned.trim())
    .slice(0, MAX_NAME_LENGTH)
    .join("")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  if (!name) name = fallback;
  return WINDOWS_RESERVED.test(name) ? `${name}_` : name;
};

/**
 * Hands out names that are unique within one folder, ignoring case, because
 * Windows and macOS treat `Ideas.md` and `ideas.md` as the same file.
 */
export const createUniqueNamer = () => {
  const used = new Set<string>();
  return (base: string, extension: string) => {
    let name = base;
    for (let copy = 2; used.has(`${name}${extension}`.toLowerCase()); copy += 1) {
      name = `${base} (${copy})`;
    }
    used.add(`${name}${extension}`.toLowerCase());
    return name;
  };
};

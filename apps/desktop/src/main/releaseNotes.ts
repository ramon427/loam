import type { BridgeReleaseNote } from "@loam/shared/bridge/loamBridge";

const MAX_RELEASES = 6;
const MAX_ITEMS_PER_RELEASE = 8;
const MAX_ITEM_LENGTH = 220;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

const decodeEntity = (entity: string) => {
  const named = NAMED_ENTITIES[entity];
  if (named) return named;
  const codePoint = entity.startsWith("#x")
    ? Number.parseInt(entity.slice(2), 16)
    : Number.parseInt(entity.slice(1), 10);
  // fromCodePoint throws outside the Unicode range.
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : `&${entity};`;
};

/** GitHub sends release notes as HTML; this keeps one line per list item or paragraph. */
const toPlainText = (input: string) =>
  input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<h([1-6])\b[^>]*>/gi, (_, level: string) => `\n${"#".repeat(Number(level))} `)
    .replace(/<\/(?:p|div|li|h[1-6]|ul|ol|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/&([a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g, (_, entity: string) => decodeEntity(entity));

const normalize = (line: string) =>
  line
    .toLowerCase()
    .replace(/[*_`#]/g, "")
    .trim();

const extractItems = (note: unknown) => {
  if (typeof note !== "string" || !note) return { items: [], totalItems: 0 };
  const items: string[] = [];
  let totalItems = 0;
  for (const rawLine of toPlainText(note).split("\n")) {
    const item = rawLine
      .trim()
      .replace(/^[-*]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .replace(/\s+/g, " ");
    const normalized = normalize(item);
    if (normalized === "new contributors" || normalized === "full changelog") break;
    if (/^#{1,6}\s+/.test(item)) continue;
    if (
      normalized === "" ||
      normalized === "what's changed" ||
      normalized === "whats changed" ||
      normalized.startsWith("compare: ") ||
      normalized.includes("/compare/")
    )
      continue;
    totalItems += 1;
    if (items.length < MAX_ITEMS_PER_RELEASE)
      items.push(
        item.length <= MAX_ITEM_LENGTH ? item : `${item.slice(0, MAX_ITEM_LENGTH - 1).trimEnd()}…`,
      );
  }
  return { items, totalItems };
};

/**
 * Turns electron-updater's release notes into what the sidebar shows: newest
 * release first, a few items each. With `fullChangelog` on they arrive as one
 * entry per release newer than the running one; otherwise as one string.
 */
export function normalizeReleaseNotes(
  releaseNotes: unknown,
  version: string,
): { releaseNotes: BridgeReleaseNote[]; omittedReleaseCount: number } {
  const entries: { version: unknown; note: unknown }[] =
    typeof releaseNotes === "string"
      ? [{ version, note: releaseNotes }]
      : Array.isArray(releaseNotes)
        ? releaseNotes.filter((entry) => typeof entry === "object" && entry !== null)
        : [];
  const notes = entries.flatMap((entry) => {
    if (typeof entry.version !== "string") return [];
    const { items, totalItems } = extractItems(entry.note);
    return totalItems === 0 ? [] : [{ version: entry.version, items, totalItems }];
  });
  return {
    releaseNotes: notes.slice(0, MAX_RELEASES),
    omittedReleaseCount: Math.max(0, notes.length - MAX_RELEASES),
  };
}

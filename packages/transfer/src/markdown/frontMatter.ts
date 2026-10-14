export type FrontMatterValue = string | number | boolean | null | undefined;

/**
 * YAML front matter. Strings use JSON quoting, which is valid YAML, so titles
 * with colons, quotes or `#` never change meaning. Empty values are skipped.
 */
export const buildFrontMatter = (fields: Record<string, FrontMatterValue>) => {
  const lines = Object.entries(fields).flatMap(([key, value]) => {
    if (value === undefined || value === null || value === "") return [];
    return [`${key}: ${typeof value === "string" ? JSON.stringify(value) : String(value)}`];
  });
  return lines.length ? `---\n${lines.join("\n")}\n---\n` : "";
};

export type ParsedFrontMatter = {
  fields: Record<string, string | string[]>;
  /** The Markdown after the front matter block. */
  body: string;
};

const FRONT_MATTER_PATTERN = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** Reads a YAML scalar as written by Loam (JSON strings) or by hand (bare or single-quoted). */
const readScalar = (raw: string) => {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "string") return parsed;
    } catch {
      // Not JSON after all; fall through to the bare value.
    }
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    return value.slice(1, -1).replace(/''/g, "'");
  return value;
};

/**
 * Splits YAML front matter from a note. Only the flat `key: value` and list
 * shapes notes use are read (title, aliases, tags, ids, dates); anything else
 * is ignored rather than guessed at.
 */
export const parseFrontMatter = (markdown: string): ParsedFrontMatter => {
  const match = FRONT_MATTER_PATTERN.exec(markdown);
  if (!match) return { fields: {}, body: markdown.replace(/^\uFEFF/, "") };
  const fields: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of match[1]!.split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line);
    if (item && listKey) {
      const list = fields[listKey];
      if (Array.isArray(list)) list.push(readScalar(item[1]!));
      continue;
    }
    const entry = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!entry) {
      listKey = null;
      continue;
    }
    const [, key, rawValue = ""] = entry;
    const value = rawValue.trim();
    if (value === "") {
      fields[key!] = [];
      listKey = key!;
      continue;
    }
    listKey = null;
    const inline = /^\[(.*)\]$/.exec(value);
    fields[key!] = inline
      ? inline[1]!
          .split(",")
          .map(readScalar)
          .filter((part) => part !== "")
      : readScalar(value);
  }
  return { fields, body: markdown.slice(match[0].length) };
};

/** A single front matter value, or undefined when it is missing or a list. */
export const readFrontMatterString = (fields: ParsedFrontMatter["fields"], key: string) => {
  const value = fields[key];
  return typeof value === "string" && value !== "" ? value : undefined;
};

/** A front matter list; a single string counts as a one-item list. */
export const readFrontMatterList = (fields: ParsedFrontMatter["fields"], key: string) => {
  const value = fields[key];
  if (Array.isArray(value)) return value;
  return typeof value === "string" && value !== "" ? [value] : [];
};

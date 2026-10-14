/**
 * Inline BlockNote content (text runs and links) to CommonMark/GFM text.
 * Input is stored JSON, so every shape is checked rather than trusted.
 */
import { readNoteHrefNoteId, readVideoTimestampHref } from "@loam/shared/notes/noteLinks";
import { isRecord } from "@loam/shared/utils/isRecord";

export type MarkdownLinkResolver = {
  /**
   * The wikilink target for an in-app note link, plus that note's title, or
   * null when the linked note is not part of the export.
   */
  noteTarget: (noteId: string) => { target: string; title: string } | null;
  /** A web link to a moment in the note's video, or null when it has none. */
  videoUrlAt: (seconds: number) => string | null;
  /**
   * Keeps note and video timestamp links as the app's own hrefs, for Markdown
   * that stays in the app, such as a text tab.
   */
  keepAppLinks?: boolean;
};

type TextRun = { text: string; styles: Record<string, unknown> };

const SAFE_LINK_PATTERN = /^(?:https?:|mailto:)/i;

const isWordCharacter = (character: string | undefined) =>
  character !== undefined && /[\p{L}\p{N}]/u.test(character);

/**
 * Escapes characters that would otherwise start Markdown syntax. Underscores
 * inside words (snake_case) stay readable because CommonMark ignores them.
 */
export const escapeMarkdownText = (text: string, { inTable = false } = {}) => {
  let escaped = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if ("\\`*[]<".includes(character)) {
      escaped += `\\${character}`;
    } else if (character === "_") {
      const insideWord = isWordCharacter(text[index - 1]) && isWordCharacter(text[index + 1]);
      escaped += insideWord ? "_" : "\\_";
    } else if (character === "~" && (text[index + 1] === "~" || text[index - 1] === "~")) {
      escaped += "\\~";
    } else if (character === "|" && inTable) {
      escaped += "\\|";
    } else {
      escaped += character;
    }
  }
  return escaped;
};

/** Stops a line's first characters from being read as a heading, quote, list or rule. */
export const escapeLineStart = (line: string) =>
  line
    .replace(/^(\s*)([#>])/, "$1\\$2")
    .replace(/^(\s*)([-+])(\s|$)/, "$1\\$2$3")
    .replace(/^(\s*)(\d+)([.)])(\s|$)/, "$1$2\\$3$4")
    .replace(/^(\s*)(=+\s*)$/, "$1\\$2")
    .replace(/^(\s*)(-{3,}\s*)$/, "$1\\$2");

const readTextRun = (value: unknown): TextRun | null => {
  if (!isRecord(value) || typeof value.text !== "string") return null;
  return { text: value.text, styles: isRecord(value.styles) ? value.styles : {} };
};

const sameStyles = (left: TextRun, right: TextRun) =>
  ["bold", "italic", "strike", "code"].every(
    (key) => Boolean(left.styles[key]) === Boolean(right.styles[key]),
  );

/** Joins neighbouring runs with the same Markdown styles, so markers never touch. */
const mergeRuns = (runs: TextRun[]) =>
  runs.reduce<TextRun[]>((merged, run) => {
    const previous = merged.at(-1);
    if (previous && sameStyles(previous, run)) {
      merged[merged.length - 1] = { text: previous.text + run.text, styles: previous.styles };
    } else {
      merged.push(run);
    }
    return merged;
  }, []);

const renderCodeSpan = (text: string) => {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longestRun + 1);
  const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${padding}${text.replace(/\n/g, " ")}${padding}${fence}`;
};

const renderRun = (run: TextRun, options: { inTable: boolean }) => {
  const { styles } = run;
  if (!run.text) return "";
  // Markers cannot sit next to whitespace, so leading and trailing spaces stay outside.
  const [, leading = "", core = "", trailing = ""] = /^(\s*)([\s\S]*?)(\s*)$/.exec(run.text) ?? [];
  if (!core) return run.text;
  let body = styles.code
    ? renderCodeSpan(core)
    : escapeMarkdownText(core, options).replace(/\n/g, options.inTable ? "<br>" : "\\\n");
  if (styles.italic) body = `*${body}*`;
  if (styles.bold) body = `**${body}**`;
  if (styles.strike) body = `~~${body}~~`;
  return `${leading}${body}${trailing}`;
};

const plainText = (content: unknown): string => {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      const run = readTextRun(item);
      if (run) return run.text;
      return isRecord(item) ? plainText(item.content) : "";
    })
    .join("");
};

const DESTINATION_ESCAPES: Record<string, string> = {
  " ": "%20",
  "(": "%28",
  ")": "%29",
  "<": "%3C",
  ">": "%3E",
};

/** Encodes the characters that would end a `[label](destination)` early. */
export const encodeLinkDestination = (href: string) =>
  href.replace(/[ ()<>]/g, (character) => DESTINATION_ESCAPES[character]!);

/** Wikilink aliases end at `|` and `]]`, so those characters cannot appear in them. */
const toWikiLinkAlias = (label: string) => label.replace(/[|\]\n]/g, " ").trim();

const renderLink = (
  link: Record<string, unknown>,
  resolver: MarkdownLinkResolver,
  options: { inTable: boolean },
) => {
  const href = typeof link.href === "string" ? link.href.trim() : "";
  const label = renderInlineContent(link.content, resolver, options);
  const labelText = plainText(link.content);

  const noteId = readNoteHrefNoteId(href);
  if (resolver.keepAppLinks && (noteId || readVideoTimestampHref(href) !== null))
    return `[${label}](${encodeLinkDestination(href)})`;
  if (noteId) {
    const note = resolver.noteTarget(noteId.toLowerCase());
    if (!note) return label;
    const alias = toWikiLinkAlias(labelText);
    const pipe = options.inTable ? "\\|" : "|";
    return !alias || alias === note.title
      ? `[[${note.target}]]`
      : `[[${note.target}${pipe}${alias}]]`;
  }

  const seconds = readVideoTimestampHref(href);
  if (seconds !== null) {
    const url = resolver.videoUrlAt(seconds);
    return url ? `[${label}](${encodeLinkDestination(url)})` : label;
  }

  // Only web and mail links survive; anything else (javascript:, file:, in-app refs) becomes text.
  if (!SAFE_LINK_PATTERN.test(href)) return label;
  return `[${label || escapeMarkdownText(href)}](${encodeLinkDestination(href)})`;
};

export function renderInlineContent(
  content: unknown,
  resolver: MarkdownLinkResolver,
  options: { inTable?: boolean } = {},
): string {
  if (!Array.isArray(content)) return "";
  const settings = { inTable: options.inTable ?? false };
  let output = "";
  let pendingRuns: TextRun[] = [];
  const flushRuns = () => {
    output += mergeRuns(pendingRuns)
      .map((run) => renderRun(run, settings))
      .join("");
    pendingRuns = [];
  };
  for (const item of content) {
    const run = readTextRun(item);
    if (run) {
      pendingRuns.push(run);
      continue;
    }
    flushRuns();
    if (!isRecord(item)) continue;
    if (item.type === "link") output += renderLink(item, resolver, settings);
    else output += renderInlineContent(item.content, resolver, settings);
  }
  flushRuns();
  return output;
}

/** Raw text of inline content, for code blocks where nothing is escaped. */
export const readInlinePlainText = plainText;

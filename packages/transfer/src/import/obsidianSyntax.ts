/**
 * Obsidian-flavoured Markdown to plain CommonMark that BlockNote can parse.
 * Wikilinks and embeds become ordinary links and images whose destinations use
 * placeholder schemes; the importer resolves those after parsing, once every
 * note has an id and every image has been copied.
 */

import { isImageFilePath } from "./importPaths";

export const IMPORT_NOTE_SCHEME = "loam-import-note:";
export const IMPORT_IMAGE_SCHEME = "loam-import-image:";

const WIKILINK_PATTERN = /(!?)\[\[([^[\]\n]+?)\]\]/g;
const FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/;
const INLINE_CODE_PATTERN = /(`+)[\s\S]*?\1/g;

/** Percent-encodes a destination so spaces and brackets can't end the Markdown link early. */
export const encodeImportDestination = (scheme: string, value: string) =>
  `${scheme}${encodeURIComponent(value).replace(/\(/g, "%28").replace(/\)/g, "%29")}`;

/** The reference behind a placeholder destination, or null for any other link. */
export const readImportDestination = (scheme: string, href: string) => {
  if (!href.startsWith(scheme)) return null;
  try {
    return decodeURIComponent(href.slice(scheme.length));
  } catch {
    return null;
  }
};

const escapeLabel = (label: string) => label.replace(/([\\[\]])/g, "\\$1");

/** `Note#Heading` shows as `Note > Heading`, as in Obsidian. */
const displayTarget = (target: string) =>
  target
    .split("#")
    .map((part) => part.replace(/^\^/, "").trim())
    .filter(Boolean)
    .join(" > ");

const rewriteWikilink = (embed: string, inner: string) => {
  const separator = inner.indexOf("|");
  const target = (separator < 0 ? inner : inner.slice(0, separator)).trim();
  const alias = separator < 0 ? "" : inner.slice(separator + 1).trim();
  if (!target) return `${embed}[[${inner}]]`;
  if (embed && isImageFilePath(target.split("#")[0]!)) {
    // `![[image.png|300]]` sets a width, not a caption.
    const caption = /^\d+(?:x\d+)?$/.test(alias) ? "" : alias;
    return `![${escapeLabel(caption)}](<${encodeImportDestination(IMPORT_IMAGE_SCHEME, target)}>)`;
  }
  // Embedded notes can't be shown inline, so they become links like any other.
  const label = alias || displayTarget(target) || target;
  return `[${escapeLabel(label)}](<${encodeImportDestination(IMPORT_NOTE_SCHEME, target)}>)`;
};

const rewriteOutsideInlineCode = (line: string) => {
  let result = "";
  let last = 0;
  for (const match of line.matchAll(INLINE_CODE_PATTERN)) {
    result += line
      .slice(last, match.index)
      .replace(WIKILINK_PATTERN, (_, embed, inner) => rewriteWikilink(embed, inner));
    result += match[0];
    last = match.index + match[0].length;
  }
  return (
    result +
    line.slice(last).replace(WIKILINK_PATTERN, (_, embed, inner) => rewriteWikilink(embed, inner))
  );
};

/** Rewrites wikilinks and embeds outside code blocks and inline code. */
export const rewriteObsidianMarkdown = (markdown: string) => {
  let fence: string | null = null;
  return markdown
    .split("\n")
    .map((line) => {
      const marker = FENCE_PATTERN.exec(line)?.[1];
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
        return line;
      }
      if (marker) {
        fence = marker;
        return line;
      }
      return rewriteOutsideInlineCode(line);
    })
    .join("\n");
};

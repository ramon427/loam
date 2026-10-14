import {
  encodeLinkDestination,
  escapeLineStart,
  readInlinePlainText,
  renderInlineContent,
  type MarkdownLinkResolver,
} from "./inlineMarkdown";
import { readNoteGraphSnapshot } from "@loam/shared/notes/noteGraphSnapshot";
import { buildNoteHref } from "@loam/shared/notes/noteLinks";
import { isRecord } from "@loam/shared/utils/isRecord";

export type BlocksToMarkdownContext = MarkdownLinkResolver & {
  /**
   * The Markdown path for a stored image reference, or null when the image is
   * not part of the export (it is then left out).
   */
  imagePath: (reference: string) => string | null;
};

type Block = {
  type: string;
  props: Record<string, unknown>;
  content: unknown;
  children: unknown[];
};

/** Which list a rendered item belongs to; items of the same list stay together. */
type ListKind = "bullet" | "numbered" | "check" | null;

type RenderedBlock = { text: string; list: ListKind };

const SAFE_URL_PATTERN = /^https?:\/\//i;

const readBlock = (value: unknown): Block | null => {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  return {
    type: value.type,
    props: isRecord(value.props) ? value.props : {},
    content: value.content,
    children: Array.isArray(value.children) ? value.children : [],
  };
};

const readString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const indentLines = (text: string, width: number) => {
  const padding = " ".repeat(width);
  return text
    .split("\n")
    .map((line) => (line ? padding + line : line))
    .join("\n");
};

/** Puts a marker in front of the first line and aligns the rest under its text. */
const withMarker = (marker: string, body: string) => {
  const [first = "", ...rest] = body.split("\n");
  const continuation = rest.length ? `\n${indentLines(rest.join("\n"), marker.length)}` : "";
  return `${marker}${first}${continuation}`;
};

const escapeParagraph = (text: string) => text.split("\n").map(escapeLineStart).join("\n");

const renderCodeBlock = (block: Block) => {
  const code = readInlinePlainText(block.content);
  const longestFence = Math.max(0, ...(code.match(/`{3,}/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestFence + 1));
  const language = readString(block.props.language).replace(/[^\w+#.-]/g, "");
  return `${fence}${language}\n${code}\n${fence}`;
};

const readTableRows = (content: unknown): unknown[][] => {
  if (!isRecord(content) || !Array.isArray(content.rows)) return [];
  return content.rows.map((row) => {
    const cells = isRecord(row) && Array.isArray(row.cells) ? row.cells : [];
    // Cells are either inline content arrays or `tableCell` objects wrapping one.
    return cells.map((cell) => (isRecord(cell) ? cell.content : cell));
  });
};

/** GFM needs a header row, so the first row always becomes the header. */
export const renderMarkdownTable = (rows: string[][]) => {
  if (rows.length === 0) return "";
  const width = Math.max(1, ...rows.map((row) => row.length));
  const padRow = (row: string[]) =>
    `| ${Array.from({ length: width }, (_, index) => row[index] || " ").join(" | ")} |`;
  const [header = [], ...body] = rows;
  return [padRow(header), `|${" --- |".repeat(width)}`, ...body.map(padRow)].join("\n");
};

const renderTable = (block: Block, context: BlocksToMarkdownContext) =>
  renderMarkdownTable(
    readTableRows(block.content).map((cells) =>
      cells.map((cell) => renderInlineContent(cell, context, { inTable: true }).trim()),
    ),
  );

const renderImage = (block: Block, context: BlocksToMarkdownContext) => {
  const url = readString(block.props.url);
  if (!url) return "";
  const alt = readString(block.props.caption) || readString(block.props.name) || "image";
  const path = context.imagePath(url) ?? (SAFE_URL_PATTERN.test(url) ? url : null);
  if (!path) return "";
  return `![${alt.replace(/[[\]\n]/g, " ")}](${encodeLinkDestination(path)})`;
};

const renderFileLink = (block: Block) => {
  const url = readString(block.props.url);
  if (!SAFE_URL_PATTERN.test(url)) return "";
  const label = readString(block.props.name) || readString(block.props.caption) || url;
  return `[${label.replace(/[[\]\n]/g, " ")}](${encodeLinkDestination(url)})`;
};

const renderListItem = (
  block: Block,
  marker: string,
  list: ListKind,
  context: BlocksToMarkdownContext,
): RenderedBlock => {
  const body = escapeParagraph(renderInlineContent(block.content, context));
  const children = renderBlocks(block.children, context);
  const item = withMarker(marker, body);
  return {
    text: children ? `${item}\n${indentLines(children, marker.length)}` : item,
    list,
  };
};

const renderBlock = (
  block: Block,
  context: BlocksToMarkdownContext,
  numberedIndex: number,
): RenderedBlock | null => {
  const inline = () => renderInlineContent(block.content, context);
  const withChildren = (text: string): RenderedBlock => {
    const children = renderBlocks(block.children, context);
    return { text: [text, children].filter(Boolean).join("\n\n"), list: null };
  };

  switch (block.type) {
    case "paragraph": {
      const text = escapeParagraph(inline());
      return text.trim() || block.children.length ? withChildren(text) : null;
    }
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(block.props.level) || 1));
      const text = inline().replace(/\\?\n/g, " ").trim();
      return withChildren(`${"#".repeat(level)} ${text}`);
    }
    case "quote": {
      const text = escapeParagraph(inline());
      return withChildren(
        text
          .split("\n")
          .map((line) => (line ? `> ${line}` : ">"))
          .join("\n"),
      );
    }
    case "codeBlock":
      return withChildren(renderCodeBlock(block));
    case "bulletListItem":
    case "toggleListItem":
      return renderListItem(block, "- ", "bullet", context);
    case "checkListItem":
      return renderListItem(block, block.props.checked ? "- [x] " : "- [ ] ", "check", context);
    case "numberedListItem":
      return renderListItem(block, `${numberedIndex}. `, "numbered", context);
    case "table":
      return withChildren(renderTable(block, context));
    case "image":
      return withChildren(renderImage(block, context));
    case "graphSnapshot": {
      const snapshot = readNoteGraphSnapshot(block.props);
      if (!snapshot) return withChildren("> Graph snapshot unavailable.");
      const sourceTitle = context.noteTarget(snapshot.noteId)?.title || "Source graph";
      const sourceLink = renderInlineContent(
        [
          {
            type: "link",
            href: buildNoteHref(snapshot.noteId),
            content: [{ type: "text", text: sourceTitle, styles: {} }],
          },
        ],
        context,
      );
      return withChildren(`> Live graph snapshot of ${sourceLink}.`);
    }
    case "video":
    case "audio":
    case "file":
      return withChildren(renderFileLink(block));
    case "divider":
    case "pageBreak":
      return { text: "---", list: null };
    case "columnList":
    case "column": {
      // Markdown has no columns, so their contents follow each other in order.
      const children = renderBlocks(block.children, context);
      return children ? { text: children, list: null } : null;
    }
    default: {
      const text = escapeParagraph(inline());
      return text.trim() || block.children.length ? withChildren(text) : null;
    }
  }
};

/** Renders a BlockNote document (or a block's children) as Markdown. */
export function renderBlocks(blocks: unknown, context: BlocksToMarkdownContext): string {
  if (!Array.isArray(blocks)) return "";
  const rendered: RenderedBlock[] = [];
  let numberedIndex = 0;
  for (const value of blocks) {
    const block = readBlock(value);
    if (!block) continue;
    if (block.type === "numberedListItem") {
      const start = Number(block.props.start);
      numberedIndex =
        numberedIndex === 0 && Number.isInteger(start) && start > 0 ? start : numberedIndex + 1;
    } else {
      numberedIndex = 0;
    }
    const output = renderBlock(block, context, numberedIndex);
    if (output && output.text.trim()) rendered.push(output);
  }
  // Items of the same list stay together; everything else is separated by a blank line.
  return rendered.reduce((markdown, block, index) => {
    if (index === 0) return block.text;
    const tight = block.list !== null && block.list === rendered[index - 1]!.list;
    return `${markdown}${tight ? "\n" : "\n\n"}${block.text}`;
  }, "");
}

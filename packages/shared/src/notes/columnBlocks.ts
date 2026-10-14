import { createBlockSpecFromTiptapNode } from "@blocknote/core";
import { Node } from "@tiptap/core";
import type { DOMOutputSpec } from "@tiptap/pm/model";

/*
 * Column layouts. A `columnList` block lays two or more `column` blocks side
 * by side, and each column holds blocks. Notes store them as
 *
 *   { type: "columnList", props: {}, children: [
 *     { type: "column", props: { width: 1 }, children: [...blocks] }, ...] }
 *
 * A column's `width` is its share of the row (its CSS flex-grow), 1 unless
 * resized. BlockNote's core already treats these two node names as blocks
 * (ids, children, moving and removing blocks), so only the nodes are defined
 * here. The HTML keeps the classes and data attributes BlockNote's columns
 * use, which the editor's styles select and pasted layouts carry.
 */

// BlockNote's suggestion marks, which its block nodes all allow.
const SUGGESTION_MARKS = "insertion modification deletion";

const DEFAULT_WIDTH = 1;

/*
 * The DOM is typed by hand here: main-process tests reach this module through
 * the transfer test kit, and their type checks have no DOM types.
 */
type ElementLike = {
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
};
type DocumentLike = { createElement: (tag: "div") => ElementLike };

const readWidth = (element: Pick<ElementLike, "getAttribute">) => {
  const width = Number.parseFloat(element.getAttribute("data-width") ?? "");
  return Number.isFinite(width) && width > 0 ? width : DEFAULT_WIDTH;
};

/**
 * A block's element, which also holds its children. BlockNote's HTML export
 * renders blocks through this and needs the element itself, not a DOM spec.
 */
const blockElement = (attributes: Record<string, unknown>) => {
  const { document } = globalThis as unknown as { document: DocumentLike };
  const element = document.createElement("div");
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) element.setAttribute(name, String(value));
  }
  return { dom: element, contentDOM: element } as unknown as DOMOutputSpec;
};

const columnNode = Node.create({
  name: "column",
  group: "bnBlock childContainer",
  content: "blockContainer+",
  defining: true,
  marks: SUGGESTION_MARKS,
  addAttributes: () => ({
    width: {
      default: DEFAULT_WIDTH,
      parseHTML: readWidth,
      renderHTML: ({ width }: { width?: unknown }) => ({
        "data-width": String(width),
        style: `flex-grow: ${String(width)};`,
      }),
    },
  }),
  parseHTML: () => [{ tag: 'div[data-node-type="column"]' }],
  renderHTML: ({ HTMLAttributes }) =>
    blockElement({ class: "bn-block-column", "data-node-type": "column", ...HTMLAttributes }),
});

const columnListNode = Node.create({
  name: "columnList",
  group: "childContainer bnBlock blockGroupChild",
  content: "column column+",
  defining: true,
  marks: SUGGESTION_MARKS,
  parseHTML: () => [{ tag: 'div[data-node-type="columnList"]' }],
  renderHTML: ({ HTMLAttributes }) =>
    blockElement({
      class: "bn-block-column-list",
      "data-node-type": "columnList",
      ...HTMLAttributes,
      style: "display: flex;",
    }),
});

/** The column blocks, to add to a BlockNote schema's `blockSpecs`. */
export const columnBlockSpecs = {
  column: createBlockSpecFromTiptapNode(
    { node: columnNode, type: "column", content: "none" },
    { width: { default: DEFAULT_WIDTH } },
  ),
  columnList: createBlockSpecFromTiptapNode(
    { node: columnListNode, type: "columnList", content: "none" },
    {},
  ),
};

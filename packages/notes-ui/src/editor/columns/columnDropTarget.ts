import type { DropCursorHooks } from "@blocknote/core";
import type { Node, Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

/** The share of a block's width, at each side, where a drop puts blocks in a column beside it. */
const COLUMN_DROP_EDGE = 0.1;

export type ColumnDropSide = "left" | "right";

/**
 * Which side of a box, if either, a pointer at `x` is on: within the outer
 * tenth of its width, inside the box.
 */
export const edgeSide = (
  x: number,
  box: { left: number; right: number },
): ColumnDropSide | null => {
  const zone = (box.right - box.left) * COLUMN_DROP_EDGE;
  if (x < box.left || x > box.right) return null;
  if (x < box.left + zone) return "left";
  if (x > box.right - zone) return "right";
  return null;
};

/** Whether a slice is whole blocks, which a column can hold. */
const isBlocksSlice = (slice: Slice) => {
  if (slice.openStart !== 0 || slice.openEnd !== 0 || slice.content.childCount === 0) return false;
  let blocks = true;
  slice.content.forEach((node) => {
    if (node.type.name !== "blockContainer") blocks = false;
  });
  return blocks;
};

/**
 * Whether the dragged blocks (the selection while dragging) would go beside
 * themselves: a block beside itself or its own parent, or a column's blocks
 * beside their column. Such a drop is an ordinary one.
 */
const dropsOnItself = (
  { from, to }: { from: number; to: number },
  { node, pos }: { node: Node; pos: number },
) => {
  const end = pos + node.nodeSize;
  if (node.type.name === "column") return from <= pos + 1 && to >= end - 1;
  return from < end && to > pos;
};

export type ColumnDropTarget = {
  side: ColumnDropSide;
  /** A column, or a block outside columns. */
  node: Node;
  /** The position before `node`. */
  pos: number;
};

/**
 * The node a drop of `slice` at the pointer goes beside as a new column, if
 * the pointer is at the edge of one: the column it's over, or else the
 * top-level block it's over. Only for blocks dragged within the editor, which
 * are its selection while they're dragged.
 */
export const columnDropTarget = (
  view: EditorView,
  event: { clientX: number; clientY: number },
  slice: Slice | null | undefined,
): ColumnDropTarget | null => {
  if (!slice || !isBlocksSlice(slice)) return null;
  const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!hit) return null;
  const { doc } = view.state;
  const $pos = doc.resolve(hit.inside >= 0 ? hit.inside : hit.pos);
  // The node the pointer is inside, then its ancestors up to the root group.
  const candidates: { node: Node; pos: number }[] = [];
  const inside = hit.inside >= 0 ? doc.nodeAt(hit.inside) : null;
  if (inside) candidates.push({ node: inside, pos: hit.inside });
  for (let depth = $pos.depth; depth > 1; depth -= 1) {
    candidates.push({ node: $pos.node(depth), pos: $pos.before(depth) });
  }
  const column = candidates.find(({ node }) => node.type.name === "column");
  const topLevel = candidates.find(({ pos }) => doc.resolve(pos).depth === 1);
  const target = column ?? (topLevel?.node.type.name === "blockContainer" ? topLevel : null);
  if (!target || dropsOnItself(view.state.selection, target)) return null;
  const dom = view.nodeDOM(target.pos);
  if (!(dom instanceof HTMLElement)) return null;
  const side = edgeSide(event.clientX, dom.getBoundingClientRect());
  return side ? { side, ...target } : null;
};

/**
 * Draws the drop cursor as a vertical line at the side of a block or column
 * that a dragged block would go beside, rather than a line between blocks.
 */
export const columnDropCursorHooks: DropCursorHooks = {
  computeDropPosition: ({ view, event, defaultPosition }) => {
    const target = columnDropTarget(view, event, view.dragging?.slice);
    if (!target) return defaultPosition;
    return {
      pos: target.pos,
      orientation: target.side === "left" ? "block-vertical-left" : "block-vertical-right",
    };
  },
};

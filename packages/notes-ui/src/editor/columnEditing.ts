import { createExtension } from "@blocknote/core";
import { Fragment, type Node, type Slice } from "@tiptap/pm/model";
import {
  NodeSelection,
  Plugin,
  Selection,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { columnDropTarget, type ColumnDropTarget } from "./columns/columnDropTarget";

/**
 * Structural editing of column layouts. BlockNote's own Backspace and Delete
 * rules for columns compute positions before `fixColumnList` reshapes the
 * document, so they leave stray empty paragraphs and dissolve layouts. These
 * rules replace them: each rebuilds the whole column list in one step, drops
 * columns left without blocks and unwraps a list down to one column.
 */

const children = (node: Node) => {
  const nodes: Node[] = [];
  node.forEach((child) => nodes.push(child));
  return nodes;
};

const withChildren = (node: Node, nodes: Node[]) => node.copy(Fragment.fromArray(nodes));

const isEmptyParagraphBlock = (block: Node | null | undefined) =>
  block?.type.name === "blockContainer" &&
  block.childCount === 1 &&
  block.firstChild!.type.name === "paragraph" &&
  block.firstChild!.content.size === 0;

/** A column holding only an empty paragraph, as a new layout starts. */
const isEmptyColumn = (column: Node) =>
  column.childCount === 1 && isEmptyParagraphBlock(column.firstChild);

/** The block a caret at the end of `block` lands in: its last nested child, if any. */
const lastLeafBlock = (block: Node): Node => {
  const group = block.childCount > 1 ? block.lastChild : null;
  const last = group?.lastChild;
  return last?.type.name === "blockContainer" ? lastLeafBlock(last) : block;
};

const positionOf = (doc: Node, target: Node) => {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node === target) found = pos;
    return found < 0;
  });
  return found;
};

/** Puts the caret `offset` characters into `block` (or at its end), selecting it if it has no text. */
const selectInBlock = (tr: Transaction, block: Node, offset: number | "end") => {
  const pos = positionOf(tr.doc, block);
  if (pos < 0) return tr;
  const content = block.firstChild!;
  if (content.isTextblock) {
    const at = offset === "end" ? content.content.size : Math.min(offset, content.content.size);
    return tr.setSelection(TextSelection.create(tr.doc, pos + 2 + at));
  }
  if (NodeSelection.isSelectable(content)) {
    return tr.setSelection(NodeSelection.create(tr.doc, pos + 1));
  }
  return tr.setSelection(Selection.near(tr.doc.resolve(pos + 1)));
};

/**
 * Replaces `from`–`to`, which spans the column list `list`, with `before`, the
 * list rebuilt from `columns` and `after`. Columns left without blocks are
 * dropped, and a single remaining column is unwrapped into its blocks.
 */
const replaceColumnList = (
  tr: Transaction,
  range: { from: number; to: number },
  list: Node,
  columns: Node[],
  before: Node[] = [],
  after: Node[] = [],
) => {
  const kept = columns.filter((column) => column.childCount > 0);
  const body =
    kept.length > 1 ? [withChildren(list, kept)] : kept.length === 1 ? children(kept[0]!) : [];
  const nodes = [...before, ...body, ...after];
  if (nodes.length === 0) nodes.push(tr.doc.type.schema.nodes["blockContainer"]!.createAndFill()!);
  return tr.replaceWith(range.from, range.to, Fragment.fromArray(nodes));
};

/** The caret's block when the selection is a caret in a block's text. */
const caretBlock = (state: EditorState) => {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $from } = selection;
  const depth = $from.depth - 1;
  if (depth < 1 || $from.node(depth).type.name !== "blockContainer") return null;
  const parent = $from.node(depth - 1);
  return {
    $from,
    depth,
    block: $from.node(depth),
    blockPos: $from.before(depth),
    parent,
    index: $from.index(depth - 1),
    atStart: $from.parentOffset === 0,
    atEnd: $from.parentOffset === $from.parent.content.size,
  };
};

type CaretBlock = NonNullable<ReturnType<typeof caretBlock>>;

/** The column list around a block that sits directly in a column. */
const columnListAround = ({ $from, depth }: CaretBlock) => {
  const listDepth = depth - 2;
  const list = $from.node(listDepth);
  const listPos = $from.before(listDepth);
  const outer = $from.node(listDepth - 1);
  const listIndex = $from.index(listDepth - 1);
  return {
    list,
    listPos,
    listEnd: listPos + list.nodeSize,
    columns: children(list),
    columnIndex: $from.index(listDepth),
    blockBefore: listIndex > 0 ? outer.child(listIndex - 1) : null,
    blockAfter: outer.maybeChild(listIndex + 1),
  };
};

/**
 * Backspace at the start of a column's first block: an empty column is
 * removed and an empty block deleted, with the caret at the end of what's
 * before them; a block with content removes an empty previous column, or else
 * moves to the end of the previous column (above the list, from the first).
 * Backspace in an empty paragraph right after a column list deletes it and
 * goes to the end of the last column.
 */
const columnBackspace = (state: EditorState): Transaction | null => {
  const caret = caretBlock(state);
  // BlockNote first turns other block types into paragraphs.
  if (!caret?.atStart || caret.block.firstChild!.type.name !== "paragraph") return null;
  const { block, blockPos, parent, index } = caret;
  const { tr } = state;

  if (parent.type.name !== "column") {
    const previous = index > 0 ? parent.child(index - 1) : null;
    if (previous?.type.name !== "columnList" || !isEmptyParagraphBlock(block)) return null;
    tr.delete(blockPos, blockPos + block.nodeSize);
    return selectInBlock(tr, lastLeafBlock(previous.lastChild!.lastChild!), "end");
  }
  if (index !== 0) return null;

  const { list, listPos, listEnd, columns, columnIndex, blockBefore } = columnListAround(caret);
  const column = columns[columnIndex]!;
  const previousColumn = columns[columnIndex - 1];

  if (previousColumn && isEmptyColumn(previousColumn) && !isEmptyParagraphBlock(block)) {
    columns[columnIndex - 1] = withChildren(previousColumn, []);
    replaceColumnList(tr, { from: listPos, to: listEnd }, list, columns);
    return selectInBlock(tr, block, 0);
  }
  columns[columnIndex] = withChildren(column, children(column).slice(1));

  if (!isEmptyParagraphBlock(block)) {
    if (previousColumn) {
      columns[columnIndex - 1] = withChildren(previousColumn, [...children(previousColumn), block]);
    }
    replaceColumnList(
      tr,
      { from: listPos, to: listEnd },
      list,
      columns,
      previousColumn ? [] : [block],
    );
    return selectInBlock(tr, block, 0);
  }

  replaceColumnList(tr, { from: listPos, to: listEnd }, list, columns);
  const landing = previousColumn
    ? lastLeafBlock(previousColumn.lastChild!)
    : blockBefore?.type.name === "blockContainer"
      ? lastLeafBlock(blockBefore)
      : null;
  if (landing) return selectInBlock(tr, landing, "end");
  const next = columns[columnIndex]!.firstChild ?? columns[columnIndex + 1]!.firstChild!;
  return selectInBlock(tr, next, 0);
};

/**
 * Delete at the end of a column's last block: an empty column is removed with
 * the caret moving on to what follows; otherwise an empty next column is
 * removed, or the next column's first block (the block after the list, from
 * the last column) moves up into this column. Delete at the end of the block
 * right before a column list moves the first column's first block up to it.
 */
const columnDelete = (state: EditorState): Transaction | null => {
  const caret = caretBlock(state);
  // A block with children takes up its first child instead (BlockNote's rule).
  if (!caret?.atEnd || caret.block.childCount > 1) return null;
  const { block, blockPos, parent, index } = caret;
  const { tr } = state;

  if (parent.type.name !== "column") {
    const next = parent.maybeChild(index + 1);
    if (next?.type.name !== "columnList") return null;
    const columns = children(next);
    const first = columns[0]!.firstChild!;
    if (isEmptyParagraphBlock(block)) {
      tr.delete(blockPos, blockPos + block.nodeSize);
      return selectInBlock(tr, first, 0);
    }
    columns[0] = withChildren(columns[0]!, children(columns[0]!).slice(1));
    const range = { from: blockPos, to: blockPos + block.nodeSize + next.nodeSize };
    replaceColumnList(tr, range, next, columns, [block, first]);
    return selectInBlock(tr, block, "end");
  }
  if (index !== parent.childCount - 1) return null;

  const { list, listPos, listEnd, columns, columnIndex, blockBefore, blockAfter } =
    columnListAround(caret);
  const column = columns[columnIndex]!;
  const nextColumn = columns[columnIndex + 1];

  if (isEmptyParagraphBlock(block)) {
    columns[columnIndex] = withChildren(column, children(column).slice(0, -1));
    replaceColumnList(tr, { from: listPos, to: listEnd }, list, columns);
    const landing =
      nextColumn?.firstChild ?? (blockAfter?.type.name === "blockContainer" ? blockAfter : null);
    if (landing) return selectInBlock(tr, landing, 0);
    const previous =
      columns[columnIndex]!.lastChild ??
      columns[columnIndex - 1]?.lastChild ??
      (blockBefore?.type.name === "blockContainer" ? blockBefore : null);
    return previous ? selectInBlock(tr, lastLeafBlock(previous), "end") : tr;
  }

  if (nextColumn) {
    if (isEmptyColumn(nextColumn)) {
      columns[columnIndex + 1] = withChildren(nextColumn, []);
    } else {
      const [first, ...rest] = children(nextColumn);
      columns[columnIndex] = withChildren(column, [...children(column), first!]);
      columns[columnIndex + 1] = withChildren(nextColumn, rest);
    }
    replaceColumnList(tr, { from: listPos, to: listEnd }, list, columns);
    return selectInBlock(tr, block, "end");
  }

  if (blockAfter?.type.name !== "blockContainer") return null;
  if (isEmptyParagraphBlock(blockAfter)) {
    return tr.delete(listEnd, listEnd + blockAfter.nodeSize);
  }
  columns[columnIndex] = withChildren(column, [...children(column), blockAfter]);
  replaceColumnList(tr, { from: listPos, to: listEnd + blockAfter.nodeSize }, list, columns);
  return selectInBlock(tr, block, "end");
};

// Enter in these empty blocks adds a paragraph below. Other types have their
// own Enter rules (a list item becomes a paragraph, a code block breaks a line).
const newLineOnEnterTypes = new Set(["paragraph", "heading", "quote"]);

/**
 * Enter in an empty block directly in a column adds a paragraph below it, as
 * it does outside columns. BlockNote counts a column's blocks as indented and
 * would lift the empty one out of the column.
 */
const columnEnter = (state: EditorState): Transaction | null => {
  const caret = caretBlock(state);
  if (!caret || caret.parent.type.name !== "column") return null;
  const { block, blockPos } = caret;
  const content = block.firstChild!;
  if (content.content.size > 0 || !newLineOnEnterTypes.has(content.type.name)) return null;
  const { schema } = state;
  const nested = block.childCount > 1 ? block.lastChild! : null;
  // The new block takes over the empty one's children, as BlockNote's Enter does.
  const paragraph = schema.nodes["blockContainer"]!.create(null, [
    schema.nodes["paragraph"]!.create(),
    ...(nested ? [nested] : []),
  ]);
  const { tr } = state;
  const after = blockPos + block.nodeSize;
  tr.insert(after, paragraph);
  if (nested) tr.delete(after - 1 - nested.nodeSize, after - 1);
  const paragraphStart = after - (nested?.nodeSize ?? 0) + 2;
  return tr.setSelection(TextSelection.create(tr.doc, paragraphStart));
};

const keyRules = {
  Backspace: columnBackspace,
  Delete: columnDelete,
  Enter: columnEnter,
} satisfies Record<string, (state: EditorState) => Transaction | null>;

/** The column rule for a plain Backspace, Delete or Enter; true when it applied. */
export const columnKeyRule = (key: keyof typeof keyRules) => (view: EditorView) => {
  const tr = keyRules[key](view.state);
  if (!tr) return false;
  view.dispatch(tr.scrollIntoView());
  return true;
};

/**
 * Dropping a block beside a column of the list it's dragged from moves it into
 * a new column there. Removing the block first, as other drops do, can
 * dissolve the list; this rebuilds the list in one step instead. Null when the
 * block isn't from the target's list.
 */
const moveWithinList = (view: EditorView, target: ColumnDropTarget, slice: Slice) => {
  if (target.node.type.name !== "column" || slice.content.childCount !== 1) return null;
  const draggedId = slice.content.child(0).attrs["id"] as unknown;
  const $column = view.state.doc.resolve(target.pos);
  const list = $column.parent;
  const source = children(list).find((column) =>
    children(column).some((block) => block.attrs["id"] === draggedId),
  );
  if (!source || draggedId === undefined) return null;

  const dragged = children(source).find((block) => block.attrs["id"] === draggedId)!;
  const { schema, tr } = view.state;
  const columns = children(list).flatMap((column) => {
    const rest = column === source ? children(column).filter((b) => b !== dragged) : null;
    const kept = rest ? withChildren(column, rest) : column;
    if (column !== target.node) return [kept];
    const added = schema.nodes["column"]!.create(null, dragged);
    return target.side === "left" ? [added, kept] : [kept, added];
  });
  const listPos = $column.before();
  replaceColumnList(tr, { from: listPos, to: listPos + list.nodeSize }, list, columns);
  return selectInBlock(tr, dragged, 0);
};

/**
 * Dropping blocks beside a column adds a column of them to its list; beside a
 * block outside columns, it puts that block and them side by side in a new
 * list. The blocks leave where they were dragged from, and a column they leave
 * empty goes (see `removeEmptiedColumns`).
 */
const dropBeside = (view: EditorView, target: ColumnDropTarget, slice: Slice) => {
  const { schema, tr } = view.state;
  tr.deleteSelection();
  const pos = tr.mapping.map(target.pos);
  const node = tr.doc.nodeAt(pos);
  if (node?.type !== target.node.type) return null;
  const added = schema.nodes["column"]!.create(null, slice.content);
  if (node.type.name === "column") {
    tr.insert(target.side === "left" ? pos : pos + node.nodeSize, added);
  } else {
    const kept = schema.nodes["column"]!.create(null, node);
    const list = schema.nodes["columnList"]!.create(
      null,
      target.side === "left" ? [added, kept] : [kept, added],
    );
    tr.replaceWith(pos, pos + node.nodeSize, list);
  }
  return selectInBlock(tr, slice.content.firstChild!, 0);
};

/**
 * Dropping dragged blocks at the left or right edge of a block or column puts
 * them in a column beside it (see `columnDropTarget`). A copy (dragged with
 * the copy modifier) drops as usual.
 */
export const handleColumnDrop = (
  view: EditorView,
  event: DragEvent,
  slice: Slice,
  moved: boolean,
) => {
  if (!moved) return false;
  const target = columnDropTarget(view, event, slice);
  if (!target) return false;
  const tr = moveWithinList(view, target, slice) ?? dropBeside(view, target, slice);
  if (!tr) return false;
  view.dispatch(tr.setMeta("uiEvent", "drop").scrollIntoView());
  view.focus();
  return true;
};

const columnStart = (state: EditorState, pos: number) => {
  const $pos = state.doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === "column") return $pos.before(depth);
  }
  return null;
};

const columnNodes = (doc: Node) => {
  const columns = new Set<Node>();
  doc.descendants((node) => {
    if (node.type.name === "column") columns.add(node);
    return node.isBlock;
  });
  return columns;
};

/**
 * After an edit that replaces a selection reaching across columns (deleting,
 * typing over or cutting it) or drops what was selected elsewhere (blocks
 * dragged out of a column), removes the columns it left empty, other than the
 * caret's, and unwraps a list left with one column. ProseMirror refills a column it empties
 * with an empty paragraph, and may rebuild it under a new id, so an emptied
 * column is one that's empty and wasn't in the document unchanged before.
 */
const removeEmptiedColumns = (
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
) => {
  if (!transactions.some((tr) => tr.docChanged)) return null;
  if (transactions.some((tr) => tr.getMeta("history$") || tr.getMeta("y-sync$"))) return null;
  const { selection } = oldState;
  if (selection.empty) return null;
  const dropped = transactions.some((tr) => tr.getMeta("uiEvent") === "drop");
  if (!dropped && columnStart(oldState, selection.from) === columnStart(oldState, selection.to)) {
    return null;
  }

  const before = columnNodes(oldState.doc);
  const lists: { node: Node; pos: number }[] = [];
  newState.doc.descendants((node, pos) => {
    if (node.type.name !== "columnList") return node.isBlock;
    lists.push({ node, pos });
    return false;
  });

  const { tr } = newState;
  const { head } = newState.selection;
  // Later lists first, so earlier positions stay valid.
  for (const { node: list, pos } of lists.reverse()) {
    let changed = false;
    let columnEnd = pos + 1;
    const columns = children(list).map((column) => {
      const holdsCaret = head > columnEnd && head < columnEnd + column.nodeSize;
      columnEnd += column.nodeSize;
      if (holdsCaret || before.has(column) || !isEmptyColumn(column)) return column;
      changed = true;
      return withChildren(column, []);
    });
    if (changed) replaceColumnList(tr, { from: pos, to: pos + list.nodeSize }, list, columns);
  }
  if (!tr.docChanged) return null;
  // Rebuilding a list maps a caret inside it to the list's edge; put it back.
  const { $head } = newState.selection;
  const caretBlockNode = $head.depth > 1 ? $head.node($head.depth - 1) : null;
  if (newState.selection.empty && caretBlockNode?.type.name === "blockContainer") {
    selectInBlock(tr, caretBlockNode, $head.parentOffset);
  }
  return tr;
};

/** Cleans up columns emptied by edits across them; see `removeEmptiedColumns`. */
export const columnEditingExtension = createExtension({
  key: "columnEditing",
  prosemirrorPlugins: [new Plugin({ appendTransaction: removeEmptiedColumns })],
});

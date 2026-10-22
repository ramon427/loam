import { getBlockInfoFromSelection } from "@blocknote/core";
import type { Fragment, Node, NodeType } from "@tiptap/pm/model";
import { NodeSelection, Selection, TextSelection, type EditorState } from "@tiptap/pm/state";
import { addRowAfter, goToNextCell, isInTable } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";

/**
 * Backspace, Delete, Enter and Tab where BlockNote's own handling loses or
 * hides content: next to images, tables and collapsed toggles, at the start
 * of a block, and in the last table cell. Each rule returns true when it
 * handled the key, and false to leave the key to BlockNote.
 */

/** A block in the document: its `blockContainer` node and the position before it. */
type BlockAt = { node: Node; pos: number };

const isBlock = (node: Node) => node.type.name === "blockContainer";
const contentOf = (block: BlockAt) => block.node.firstChild!;
const hasInlineContent = (node: Node) => node.type.spec.content === "inline*";
const isTable = (node: Node) => node.type.name === "table";
const childGroupOf = (block: BlockAt) => (block.node.childCount > 1 ? block.node.lastChild : null);
const blockEnd = (block: BlockAt) => block.pos + block.node.nodeSize;

const listTypes = new Set([
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem",
]);

/** The block holding an empty caret, when the caret is in that block's own text. */
const caretBlock = (state: EditorState) => {
  const { selection } = state;
  if (!selection.empty || !(selection instanceof TextSelection)) return null;
  const info = getBlockInfoFromSelection(state);
  if (!info.isBlockContainer || selection.$from.parent !== info.blockContent.node) return null;
  const content = info.blockContent.node;
  const offset = selection.$from.parentOffset;
  return {
    block: { node: info.bnBlock.node, pos: info.bnBlock.beforePos },
    content,
    atStart: offset === 0,
    atEnd: offset === content.content.size,
  };
};

const previousSibling = (doc: Node, block: BlockAt): BlockAt | null => {
  const before = doc.resolve(block.pos).nodeBefore;
  return before ? { node: before, pos: block.pos - before.nodeSize } : null;
};

const nextSibling = (doc: Node, block: BlockAt): BlockAt | null => {
  const after = doc.resolve(blockEnd(block)).nodeAfter;
  return after ? { node: after, pos: blockEnd(block) } : null;
};

/** The block this one is nested in; null at the top level and in columns. */
const parentBlock = (doc: Node, block: BlockAt): BlockAt | null => {
  const $pos = doc.resolve(block.pos);
  if ($pos.depth < 2) return null;
  const parent = $pos.node($pos.depth - 1);
  return isBlock(parent) ? { node: parent, pos: $pos.before($pos.depth - 1) } : null;
};

const firstChild = (block: BlockAt): BlockAt | null => {
  const group = childGroupOf(block);
  if (!group?.firstChild) return null;
  return { node: group.firstChild, pos: block.pos + 1 + contentOf(block).nodeSize + 1 };
};

const lastChild = (block: BlockAt): BlockAt | null => {
  const group = childGroupOf(block);
  if (!group?.lastChild) return null;
  return { node: group.lastChild, pos: blockEnd(block) - 2 - group.lastChild.nodeSize };
};

/** Whether the block is a toggle (list item or heading) showing its children. */
const isToggle = (node: Node) =>
  node.type.name === "toggleListItem" ||
  (node.type.name === "heading" && node.attrs.isToggleable === true);

/** Whether the block is a toggle whose children are hidden, read from its rendered button. */
const isCollapsedToggle = (view: EditorView, block: BlockAt) => {
  if (!isToggle(contentOf(block))) return false;
  const dom = view.nodeDOM(block.pos + 1);
  const wrapper = dom instanceof HTMLElement ? dom.querySelector(".bn-toggle-wrapper") : null;
  return wrapper?.getAttribute("data-show-children") === "false";
};

/** The last block shown at the bottom of `block`, stopping at collapsed toggles. */
const lastVisibleDescendant = (view: EditorView, block: BlockAt) => {
  let current = block;
  for (let child = lastChild(current); child; child = lastChild(current)) {
    if (isCollapsedToggle(view, current)) break;
    current = child;
  }
  return current;
};

const lastDescendant = (block: BlockAt) => {
  let current = block;
  for (let child = lastChild(current); child; child = lastChild(current)) current = child;
  return current;
};

/** The next block below at the same or a shallower level, as BlockNote's Delete finds it. */
const nextBlockAtAnyLevel = (doc: Node, block: BlockAt): BlockAt | null => {
  for (let current: BlockAt | null = block; current; current = parentBlock(doc, current)) {
    const next = nextSibling(doc, current);
    if (next) return next;
  }
  return null;
};

const createBlock = (state: EditorState, type: NodeType) =>
  state.schema.nodes.blockContainer!.createAndFill(null, type.createAndFill()!)!;

/**
 * Moves `block`'s text onto the end of `target`'s text and its children up to
 * its own level, as a merge into a block whose children are hidden.
 */
const mergeInto = (view: EditorView, block: BlockAt, targetTextEnd: number) => {
  const { tr } = view.state;
  const children = childGroupOf(block)?.content;
  tr.delete(block.pos, blockEnd(block));
  if (children) tr.insert(tr.mapping.map(block.pos), children as Fragment);
  const at = tr.mapping.map(targetTextEnd, -1);
  tr.insert(at, contentOf(block).content);
  tr.setSelection(TextSelection.create(tr.doc, at));
  view.dispatch(tr.scrollIntoView());
};

/** Puts the selection on a block that has no text of its own. */
const selectBlockWithoutText = (view: EditorView, block: BlockAt, side: "start" | "end") => {
  const { doc, tr } = view.state;
  const content = contentOf(block);
  const selection = isTable(content)
    ? side === "start"
      ? Selection.near(doc.resolve(block.pos + 2), 1)
      : Selection.near(doc.resolve(block.pos + content.nodeSize), -1)
    : NodeSelection.create(doc, block.pos + 1);
  view.dispatch(tr.setSelection(selection).scrollIntoView());
};

/**
 * Backspace at the start of a top-level paragraph, where BlockNote would
 * delete an image or graph snapshot above in one keystroke, do nothing under a
 * table, or merge the text into a collapsed toggle's hidden last child. It
 * selects the image or snapshot, moves into the table's last cell, or merges
 * into the toggle's own text instead.
 */
export const backspaceIntoBlockAbove = (view: EditorView) => {
  const caret = caretBlock(view.state);
  if (!caret?.atStart || caret.content.type.name !== "paragraph") return false;
  const { doc } = view.state;
  // A nested paragraph is outdented by BlockNote first.
  if (parentBlock(doc, caret.block)) return false;
  const previous = previousSibling(doc, caret.block);
  if (!previous || !isBlock(previous.node)) return false;

  const target = lastVisibleDescendant(view, previous);
  const targetContent = contentOf(target);
  if (!hasInlineContent(targetContent)) {
    // BlockNote removes an empty paragraph and selects the block above, and
    // deletes a divider outright, which loses nothing.
    if (caret.content.content.size === 0 || targetContent.type.name === "divider") return false;
    selectBlockWithoutText(view, target, "end");
    return true;
  }
  if (target.pos === lastDescendant(previous).pos) return false;
  mergeInto(view, caret.block, target.pos + targetContent.nodeSize);
  return true;
};

/**
 * Backspace at the start of a code block turns it into a paragraph, as
 * BlockNote does, but with its lines kept as line breaks. BlockNote moves the
 * code's newline characters into the paragraph's text as they are.
 */
export const backspaceCodeIntoParagraph = (view: EditorView) => {
  const caret = caretBlock(view.state);
  if (!caret?.atStart || !caret.content.type.spec.code) return false;
  const text = caret.content.textContent;
  if (!text.includes("\n")) return false;
  const { schema, tr } = view.state;
  const inline = text
    .split("\n")
    .flatMap((line, index) => [
      ...(index > 0 ? [schema.nodes.hardBreak!.create()] : []),
      ...(line ? [schema.text(line)] : []),
    ]);
  const at = caret.block.pos + 1;
  tr.replaceWith(at, at + caret.content.nodeSize, schema.nodes.paragraph!.create(null, inline));
  tr.setSelection(TextSelection.create(tr.doc, at + 1));
  view.dispatch(tr.scrollIntoView());
  return true;
};

/**
 * Delete at the end of a block, where BlockNote would delete an image, table
 * or graph snapshot below in one keystroke, or pull a collapsed toggle's
 * hidden first child into its text. It selects the block below (or enters the
 * table's first cell) instead, and a collapsed toggle merges the next block
 * shown below it.
 */
export const deleteIntoBlockBelow = (view: EditorView) => {
  const caret = caretBlock(view.state);
  if (!caret?.atEnd || !hasInlineContent(caret.content)) return false;
  const { doc } = view.state;
  const collapsed = isCollapsedToggle(view, caret.block) && childGroupOf(caret.block) !== null;
  const next = collapsed
    ? nextBlockAtAnyLevel(doc, caret.block)
    : (firstChild(caret.block) ?? nextBlockAtAnyLevel(doc, caret.block));
  // Columns have their own Delete handling.
  if (!next || !isBlock(next.node)) return collapsed;

  const nextContent = contentOf(next);
  if (!hasInlineContent(nextContent)) {
    if (nextContent.type.name === "divider") return false;
    selectBlockWithoutText(view, next, "start");
    return true;
  }
  if (!collapsed) return false;
  mergeInto(view, next, view.state.selection.from);
  return true;
};

/**
 * Delete in an empty block removes it, so the block below keeps its type
 * instead of being merged up into the empty one.
 */
export const removeEmptyBlockOnDelete = (view: EditorView) => {
  const caret = caretBlock(view.state);
  if (!caret || !hasInlineContent(caret.content) || childGroupOf(caret.block)) return false;
  let isEmpty = true;
  caret.content.forEach((child) => {
    if (!child.isText || child.text!.trim()) isEmpty = false;
  });
  const { doc, tr } = view.state;
  const next = nextSibling(doc, caret.block);
  if (!isEmpty || !next || !isBlock(next.node)) return false;
  tr.delete(caret.block.pos, blockEnd(caret.block));
  const nextContent = contentOf(next);
  const at = caret.block.pos;
  tr.setSelection(
    hasInlineContent(nextContent)
      ? TextSelection.create(tr.doc, at + 2)
      : isTable(nextContent)
        ? Selection.near(tr.doc.resolve(at + 2), 1)
        : NodeSelection.create(tr.doc, at + 1),
  );
  view.dispatch(tr.scrollIntoView());
  return true;
};

/**
 * Enter at the end of a toggle's text, when it has children. BlockNote splits
 * the toggle and hands its children to the new, empty one. An open toggle gets
 * a new first child instead, and a collapsed one a new block after it, its
 * children staying where they are.
 */
export const enterAtToggleEnd = (view: EditorView) => {
  const caret = caretBlock(view.state);
  if (!caret?.atEnd || caret.content.content.size === 0 || !isToggle(caret.content)) return false;
  const child = firstChild(caret.block);
  if (!child) return false;
  const { state } = view;
  const { paragraph, toggleListItem } = state.schema.nodes;
  const collapsed = isCollapsedToggle(view, caret.block);
  const type =
    collapsed && caret.content.type.name === "toggleListItem" ? toggleListItem! : paragraph!;
  const at = collapsed ? blockEnd(caret.block) : child.pos;
  const tr = state.tr.insert(at, createBlock(state, type));
  tr.setSelection(TextSelection.create(tr.doc, at + 2));
  view.dispatch(tr.scrollIntoView());
  return true;
};

/**
 * Enter at the start of a block with text adds an empty block above and
 * leaves the text, its type, props (a ticked checkbox) and children in place.
 * BlockNote would split the block, keeping the props on the empty half.
 */
export const enterAtBlockStart = (view: EditorView) => {
  const caret = caretBlock(view.state);
  if (!caret?.atStart || caret.content.content.size === 0) return false;
  if (!hasInlineContent(caret.content) || caret.content.type.spec.code) return false;
  const { state } = view;
  const type = listTypes.has(caret.content.type.name)
    ? caret.content.type
    : state.schema.nodes.paragraph!;
  view.dispatch(state.tr.insert(caret.block.pos, createBlock(state, type)).scrollIntoView());
  return true;
};

/**
 * Tab in a table's last cell adds a row and moves into it, where BlockNote
 * would move the focus out of the editor.
 */
export const addTableRowOnTab = (view: EditorView) => {
  const { state } = view;
  if (!isInTable(state) || goToNextCell(1)(state)) return false;
  if (!addRowAfter(state, view.dispatch)) return false;
  goToNextCell(1)(view.state, view.dispatch);
  return true;
};

const CODE_INDENT = "  ";

/**
 * Tab over several lines of a code block indents each of them, and Shift+Tab
 * outdents the lines under the selection. BlockNote only inserts spaces at
 * the caret, replacing any selection.
 */
export const indentCodeLines = (view: EditorView, outdent: boolean) => {
  const { state } = view;
  const { $from, $to, from, to } = state.selection;
  if (!$from.parent.type.spec.code || $from.parent !== $to.parent) return false;
  const text = $from.parent.textContent;
  const start = $from.start();
  const firstLine = text.lastIndexOf("\n", $from.parentOffset - 1) + 1;
  if (!outdent && !text.slice($from.parentOffset, $to.parentOffset).includes("\n")) return false;

  const lineStarts = [firstLine];
  for (
    let index = text.indexOf("\n", firstLine);
    index !== -1;
    index = text.indexOf("\n", index + 1)
  ) {
    if (index >= $to.parentOffset) break;
    lineStarts.push(index + 1);
  }
  const { tr } = state;
  for (const lineStart of lineStarts.reverse()) {
    if (outdent) {
      const spaces = /^ {0,2}/.exec(text.slice(lineStart))![0].length;
      if (spaces) tr.delete(start + lineStart, start + lineStart + spaces);
    } else {
      tr.insertText(CODE_INDENT, start + lineStart);
    }
  }
  if (tr.docChanged) {
    const mappedFrom = tr.mapping.map(from, -1);
    const mappedTo = tr.mapping.map(to);
    tr.setSelection(TextSelection.create(tr.doc, Math.max(start, mappedFrom), mappedTo));
    view.dispatch(tr);
  }
  return true;
};

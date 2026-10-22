// @vitest-environment jsdom

import { NodeSelection } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";
import { useEffect } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { BlockNoteEditorView } from "../../blocknote/BlockNoteEditorView";
import { handleColumnDrop } from "../../columnEditing";
import type { NoteBlock, NoteBlockEditor, NotePartialBlock } from "../../noteEditorSchema";
import { inlineText } from "../../noteEditorSchema";
import { useNoteEditor } from "../../useNoteEditor";
import { columnDropTarget, edgeSide } from "../columnDropTarget";

describe("edgeSide", () => {
  const box = { left: 100, right: 300 };

  it("is the side whose outer tenth the pointer is in", () => {
    expect(edgeSide(100, box)).toBe("left");
    expect(edgeSide(119, box)).toBe("left");
    expect(edgeSide(281, box)).toBe("right");
    expect(edgeSide(300, box)).toBe("right");
  });

  it("is neither in the middle or outside the box", () => {
    expect(edgeSide(120, box)).toBeNull();
    expect(edgeSide(200, box)).toBeNull();
    expect(edgeSide(280, box)).toBeNull();
    expect(edgeSide(99, box)).toBeNull();
    expect(edgeSide(301, box)).toBeNull();
  });
});

// Every block is laid out 100px wide, so x = 5 is a left edge and x = 95 a right one.
beforeAll(() => {
  Object.assign(Range.prototype, {
    getClientRects: () => [],
    getBoundingClientRect: () => new DOMRect(),
  });
});
afterEach(() => vi.restoreAllMocks());

let editor: NoteBlockEditor;

function Note({ blocks }: { blocks: NotePartialBlock[] }) {
  const noteEditor = useNoteEditor({
    createDecorations: () => DecorationSet.empty,
    initialContent: blocks,
    uploadFile: vi.fn(),
  });
  useEffect(() => {
    editor = noteEditor;
  }, [noteEditor]);
  return <BlockNoteEditorView editor={noteEditor} theme="light" />;
}

const p = (text: string): NotePartialBlock => ({ type: "paragraph", content: text });
const column = (...texts: string[]): NotePartialBlock => ({
  type: "column",
  children: texts.map(p),
});
const columns = (...list: NotePartialBlock[]): NotePartialBlock => ({
  type: "columnList",
  children: list,
});

type Outline = string | Outline[];
const outline = (blocks: NoteBlock[]): Outline[] =>
  blocks.map((block) =>
    block.type === "columnList" || block.type === "column"
      ? outline(block.children)
      : inlineText(block.content),
  );

/** The position before the block holding a paragraph of `text`. */
const blockPos = (text: string) => {
  let found = -1;
  editor.prosemirrorView!.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name === "blockContainer" && node.firstChild!.textContent === text) found = pos;
    return found < 0;
  });
  return found;
};

/**
 * Opens a note, drags the block of `dragged` (selecting it, as a drag from its
 * handle does) and drops it with the pointer over the text `over` at `x`.
 */
const drop = (blocks: NotePartialBlock[], dragged: string, over: string, x: number) => {
  render(<Note blocks={blocks} />);
  const view = editor.prosemirrorView!;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 100, 20),
  );
  vi.spyOn(view, "posAtCoords").mockReturnValue({ pos: blockPos(over) + 2, inside: -1 });
  act(() => {
    view.dispatch(
      view.state.tr.setSelection(NodeSelection.create(view.state.doc, blockPos(dragged))),
    );
  });
  const slice = view.state.selection.content();
  const event = { clientX: x, clientY: 10 } as DragEvent;
  let handled = false;
  act(() => {
    handled = handleColumnDrop(view, event, slice, true);
  });
  return {
    handled,
    doc: outline(editor.document),
    target: () => columnDropTarget(view, event, slice),
  };
};

describe("dropping a block at the edge of another", () => {
  it("puts a block dropped at a block's left edge in a column before it", () => {
    const { handled, doc } = drop([p("A"), p("B")], "B", "A", 5);
    expect(handled).toBe(true);
    expect(doc).toEqual([[["B"], ["A"]]]);
  });

  it("puts a block dropped at a block's right edge in a column after it", () => {
    const { doc } = drop([p("A"), p("B"), p("C")], "A", "C", 95);
    expect(doc).toEqual(["B", [["C"], ["A"]]]);
  });

  it("adds a column to a list when dropped at a column's edge", () => {
    const { doc } = drop([columns(column("A"), column("B")), p("D")], "D", "A", 95);
    expect(doc).toEqual([[["A"], ["D"], ["B"]]]);
  });

  it("moves a block into a new column within its own list", () => {
    const { doc } = drop([columns(column("A"), column("B1", "B2"))], "B2", "A", 5);
    expect(doc).toEqual([[["B2"], ["A"], ["B1"]]]);
  });

  it("dissolves the list a dragged block leaves with one column", () => {
    const { doc } = drop([columns(column("A"), column("B")), p("D")], "B", "D", 5);
    expect(doc).toEqual(["A", [["B"], ["D"]]]);
  });

  it("leaves the middle of a block and a block's own edge to an ordinary drop", () => {
    expect(drop([p("A"), p("B")], "B", "A", 50).handled).toBe(false);
    const own = drop([p("A"), p("B")], "B", "B", 5);
    expect(own.handled).toBe(false);
    expect(own.target()).toBeNull();
  });
});

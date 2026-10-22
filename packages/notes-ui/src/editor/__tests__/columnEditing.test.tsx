// @vitest-environment jsdom

import { TextSelection } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";
import { useEffect } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { BlockNoteEditorView } from "../blocknote/BlockNoteEditorView";
import type { NoteBlock, NoteBlockEditor, NotePartialBlock } from "../noteEditorSchema";
import { inlineText } from "../noteEditorSchema";
import { useNoteEditor } from "../useNoteEditor";

// The rules scroll the caret into view, which measures text jsdom can't lay out.
beforeAll(() => {
  Object.assign(Range.prototype, {
    getClientRects: () => [],
    getBoundingClientRect: () => new DOMRect(),
  });
});

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

/** The document as text: a paragraph is its text ("" when empty), columns are arrays. */
type Outline = string | Outline[];
const outline = (blocks: NoteBlock[]): Outline[] =>
  blocks.map((block) =>
    block.type === "columnList" || block.type === "column"
      ? outline(block.children)
      : inlineText(block.content),
  );

/** The caret as "text|" around its offset in the caret's block. */
const caret = () => {
  const { $from } = editor.prosemirrorView!.state.selection;
  const text = $from.parent.textContent;
  return `${text.slice(0, $from.parentOffset)}|${text.slice($from.parentOffset)}`;
};

/** Opens a note with `blocks` and puts the caret at `at` ("text|" marks the offset). */
const open = (blocks: NotePartialBlock[], at: string) => {
  const result = render(<Note blocks={blocks} />);
  const offset = at.indexOf("|");
  const text = at.replace("|", "");
  const view = editor.prosemirrorView!;
  let pos = -1;
  view.state.doc.descendants((node, nodePos) => {
    if (pos >= 0) return false;
    if (node.type.name === "paragraph" && node.textContent === text) pos = nodePos + 1 + offset;
    return pos < 0;
  });
  act(() => {
    view.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
  });
  return result.container.querySelector(".ProseMirror")!;
};

const press = (dom: Element, key: string) => act(() => void fireEvent.keyDown(dom, { key }));

const doc = () => outline(editor.document);

describe("Backspace in columns", () => {
  it("removes an empty last column and unwraps the one left, caret at its end", () => {
    const dom = open([p("Before"), columns(column("Left"), column("")), p("After")], "|");
    press(dom, "Backspace");
    expect(doc()).toEqual(["Before", "Left", "After"]);
    expect(caret()).toBe("Left|");
  });

  it("removes an empty middle column and keeps the others", () => {
    const dom = open([columns(column("A"), column(""), column("C"))], "|");
    press(dom, "Backspace");
    expect(doc()).toEqual([[["A"], ["C"]]]);
    expect(caret()).toBe("A|");
  });

  it("removes an empty first column, caret at the end of the block above", () => {
    const dom = open([p("Before"), columns(column(""), column("Right"))], "|");
    press(dom, "Backspace");
    expect(doc()).toEqual(["Before", "Right"]);
    expect(caret()).toBe("Before|");
  });

  it("removes an empty column before the caret's one", () => {
    const dom = open([columns(column("A"), column(""), column("C"))], "|C");
    press(dom, "Backspace");
    expect(doc()).toEqual([[["A"], ["C"]]]);
    expect(caret()).toBe("|C");
  });

  it("deletes an empty first block of a column, caret at the end of the previous column", () => {
    const dom = open([columns(column("A1", "A2"), column("", "B2"))], "|");
    press(dom, "Backspace");
    expect(doc()).toEqual([[["A1", "A2"], ["B2"]]]);
    expect(caret()).toBe("A2|");
  });

  it("moves a block with text to the end of the previous column", () => {
    const dom = open([columns(column("A1"), column("B1", "B2"))], "|B1");
    press(dom, "Backspace");
    expect(doc()).toEqual([[["A1", "B1"], ["B2"]]]);
    expect(caret()).toBe("|B1");
  });

  it("deletes an empty paragraph after a column list, caret at the end of the last column", () => {
    const dom = open([columns(column("A"), column("B")), p("")], "|");
    press(dom, "Backspace");
    expect(doc()).toEqual([[["A"], ["B"]]]);
    expect(caret()).toBe("B|");
  });

  it("undoes a column removal in one step", () => {
    const dom = open([p("Before"), columns(column("Left"), column("")), p("After")], "|");
    press(dom, "Backspace");
    act(() => void editor.undo());
    expect(doc()).toEqual(["Before", [["Left"], [""]], "After"]);
  });
});

describe("Delete in columns", () => {
  it("removes an empty column, caret at the start of the next", () => {
    const dom = open([columns(column("A"), column(""), column("C"))], "|");
    press(dom, "Delete");
    expect(doc()).toEqual([[["A"], ["C"]]]);
    expect(caret()).toBe("|C");
  });

  it("removes an empty next column", () => {
    const dom = open([columns(column("A"), column("")), p("After")], "A|");
    press(dom, "Delete");
    expect(doc()).toEqual(["A", "After"]);
    expect(caret()).toBe("A|");
  });

  it("moves the next column's first block up, caret staying put", () => {
    const dom = open([columns(column("A"), column("B1", "B2"))], "A|");
    press(dom, "Delete");
    expect(doc()).toEqual([[["A", "B1"], ["B2"]]]);
    expect(caret()).toBe("A|");
  });

  it("deletes an empty paragraph after the list from the last column", () => {
    const dom = open([columns(column("A"), column("B")), p("")], "B|");
    press(dom, "Delete");
    expect(doc()).toEqual([[["A"], ["B"]]]);
  });
});

describe("Enter in columns", () => {
  it("adds a paragraph below an empty block instead of leaving the column", () => {
    const dom = open([columns(column("A", ""), column("B"))], "|");
    press(dom, "Enter");
    expect(doc()).toEqual([[["A", "", ""], ["B"]]]);
    expect(editor.getTextCursorPosition().prevBlock).toBeDefined();
  });
});

describe("Selections across columns", () => {
  const selectAndDelete = (blocks: NotePartialBlock[], from: string, to: string) => {
    const dom = open(blocks, from);
    const view = editor.prosemirrorView!;
    const anchor = view.state.selection.from;
    let head = -1;
    const text = to.replace("|", "");
    view.state.doc.descendants((node, pos) => {
      if (head >= 0) return false;
      if (node.type.name === "paragraph" && node.textContent === text) {
        head = pos + 1 + to.indexOf("|");
      }
      return head < 0;
    });
    act(() => {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)));
    });
    press(dom, "Backspace");
  };

  it("removes the column a deletion empties and unwraps the list", () => {
    selectAndDelete(
      [p("Before"), columns(column("Alpha"), column("Beta")), p("After")],
      "Al|pha",
      "Beta|",
    );
    expect(doc()).toEqual(["Before", "Al", "After"]);
    expect(caret()).toBe("Al|");
  });

  it("removes a column emptied by a deletion from above the list", () => {
    selectAndDelete(
      [p("Before"), columns(column("Alpha"), column("Beta")), p("After")],
      "Be|fore",
      "Alpha|",
    );
    expect(doc()).toEqual(["Be", "Beta", "After"]);
    expect(caret()).toBe("Be|");
  });
});

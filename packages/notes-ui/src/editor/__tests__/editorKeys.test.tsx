// @vitest-environment jsdom

import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";
import { useEffect } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BlockNoteEditorView } from "../blocknote/BlockNoteEditorView";
import type { NoteBlock, NoteBlockEditor, NotePartialBlock } from "../noteEditorSchema";
import { useNoteEditor } from "../useNoteEditor";

// The formatting toolbar measures a text selection, and jsdom's ranges have no layout.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

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

afterEach(() => localStorage.clear());

const text = (content: NoteBlock["content"]): string =>
  Array.isArray(content)
    ? content.map((item) => (item.type === "text" ? item.text : `<${item.type}>`)).join("")
    : "";

/** The document as `type: text` lines, children indented. */
const outline = (blocks: NoteBlock[] = editor.document, depth = 0): string[] =>
  blocks.flatMap((block) => [
    `${"  ".repeat(depth)}${block.type}: ${text(block.content)}`,
    ...outline(block.children, depth + 1),
  ]);

const selectedNode = () => {
  const { selection } = editor.prosemirrorState;
  return selection instanceof NodeSelection ? selection.node.type.name : null;
};

/** Moves the selection to `from`..`to` characters past the caret. */
const selectFromCaret = (from: number, to = from) =>
  act(() => {
    const view = editor.prosemirrorView!;
    const start = view.state.selection.from;
    const { doc } = view.state;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, start + from, start + to)));
  });

const caret = () => {
  const { $from } = editor.prosemirrorState.selection;
  return `${$from.parent.type.name}:${$from.parent.textContent}@${$from.parentOffset}`;
};

/** Renders the note, opening the toggles listed, with the caret in block `id`. */
const setUp = (
  blocks: NotePartialBlock[],
  id: string,
  side: "start" | "end",
  { openToggles = [] as string[] } = {},
) => {
  for (const toggle of openToggles) localStorage.setItem(`toggle-${toggle}`, "true");
  const { container } = render(<Note blocks={blocks} />);
  act(() => editor.setTextCursorPosition(id, side));
  const press = (key: string, options: { shiftKey?: boolean; ctrlKey?: boolean } = {}) =>
    act(() => {
      fireEvent.keyDown(container.querySelector(".ProseMirror")!, { key, ...options });
    });
  const typeText = (typed: string) =>
    act(() => {
      for (const character of typed) {
        const view = editor.prosemirrorView!;
        const { from, to } = view.state.selection;
        const handled = view.someProp("handleTextInput", (handle) =>
          handle(view, from, to, character, () => view.state.tr.insertText(character, from, to)),
        );
        if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
      }
    });
  return { press, typeText };
};

const paragraph = (id: string, content: string, children: NotePartialBlock[] = []) =>
  ({ id, type: "paragraph", content, children }) as NotePartialBlock;
const toggle = (id: string, content: string, children: NotePartialBlock[]) =>
  ({ id, type: "toggleListItem", content, children }) as NotePartialBlock;
const table = (id: string, rows: string[][]) =>
  ({
    id,
    type: "table",
    content: { type: "tableContent", rows: rows.map((cells) => ({ cells })) },
  }) as NotePartialBlock;

describe("Backspace at the start of a block", () => {
  it("selects an image above rather than deleting it", () => {
    const { press } = setUp(
      [{ id: "img", type: "image", props: { url: "a.png" } }, paragraph("p", "Text")],
      "p",
      "start",
    );
    press("Backspace");
    expect(outline()).toEqual(["image: ", "paragraph: Text"]);
    expect(selectedNode()).toBe("image");
  });

  it("moves into the last cell of a table above", () => {
    const { press } = setUp([table("t", [["a", "b"]]), paragraph("p", "Text")], "p", "start");
    press("Backspace");
    expect(caret()).toBe("tableParagraph:b@1");
  });

  it("merges into a collapsed toggle's own text, not its hidden child", () => {
    const { press } = setUp(
      [toggle("t", "Toggle", [paragraph("c", "hidden")]), paragraph("p", "Text")],
      "p",
      "start",
    );
    press("Backspace");
    expect(outline()).toEqual(["toggleListItem: ToggleText", "  paragraph: hidden"]);
    expect(caret()).toBe("toggleListItem:ToggleText@6");
  });

  it("keeps the lines of a code block it turns into a paragraph", () => {
    const { press } = setUp(
      [{ id: "code", type: "codeBlock", content: "one\ntwo" }],
      "code",
      "start",
    );
    press("Backspace");
    const nodes: string[] = [];
    editor.prosemirrorState.doc.descendants((node) => {
      if (node.isInline) nodes.push(node.isText ? node.text! : node.type.name);
    });
    expect(outline()).toEqual(["paragraph: one\ntwo"]);
    expect(nodes).toEqual(["one", "hardBreak", "two"]);
  });

  it("turns a Markdown shortcut back into the text typed", () => {
    const { press, typeText } = setUp([paragraph("p", "")], "p", "start");
    typeText("- ");
    expect(outline()).toEqual(["bulletListItem: "]);
    press("Backspace");
    expect(outline()).toEqual(["paragraph: - "]);
  });
});

describe("Delete at the end of a block", () => {
  it("selects an image below rather than deleting it", () => {
    const { press } = setUp(
      [paragraph("p", "Text"), { id: "img", type: "image", props: { url: "a.png" } }],
      "p",
      "end",
    );
    press("Delete");
    expect(outline()).toEqual(["paragraph: Text", "image: "]);
    expect(selectedNode()).toBe("image");
  });

  it("moves into the first cell of a table below rather than deleting it", () => {
    const { press } = setUp([paragraph("p", "Text"), table("t", [["a", "b"]])], "p", "end");
    press("Delete");
    expect(outline()).toEqual(["paragraph: Text", "table: "]);
    expect(caret()).toBe("tableParagraph:a@0");
  });

  it("merges the block after a collapsed toggle, not its hidden child", () => {
    const { press } = setUp(
      [toggle("t", "Toggle", [paragraph("c", "hidden")]), paragraph("p", "Text")],
      "t",
      "end",
    );
    press("Delete");
    expect(outline()).toEqual(["toggleListItem: ToggleText", "  paragraph: hidden"]);
  });

  it("removes an empty block so the one below keeps its type", () => {
    const { press } = setUp(
      [
        { id: "b", type: "bulletListItem" },
        { id: "h", type: "heading", content: "Title" },
      ],
      "b",
      "end",
    );
    press("Delete");
    expect(outline()).toEqual(["heading: Title"]);
    expect(caret()).toBe("heading:Title@0");
  });
});

describe("Enter", () => {
  it("adds a block after a collapsed toggle, leaving its children in it", () => {
    const { press } = setUp([toggle("t", "Toggle", [paragraph("c", "hidden")])], "t", "end");
    press("Enter");
    expect(outline()).toEqual([
      "toggleListItem: Toggle",
      "  paragraph: hidden",
      "toggleListItem: ",
    ]);
    expect(caret()).toBe("toggleListItem:@0");
  });

  it("adds a first child to an open toggle", () => {
    const { press } = setUp([toggle("t", "Toggle", [paragraph("c", "child")])], "t", "end", {
      openToggles: ["t"],
    });
    press("Enter");
    expect(outline()).toEqual(["toggleListItem: Toggle", "  paragraph: ", "  paragraph: child"]);
    expect(caret()).toBe("paragraph:@0");
  });

  it("at the start of a block adds an empty one above, the block keeping its props", () => {
    const { press } = setUp(
      [{ id: "c", type: "checkListItem", props: { checked: true }, content: "Done" }],
      "c",
      "start",
    );
    press("Enter");
    expect(editor.document.map((block) => [block.type, block.props, text(block.content)])).toEqual([
      ["checkListItem", expect.objectContaining({ checked: false }), ""],
      ["checkListItem", expect.objectContaining({ checked: true }), "Done"],
    ]);
    expect(caret()).toBe("checkListItem:Done@0");
  });

  it("does not add a block when Shift is held", () => {
    const { press } = setUp([paragraph("p", "Text")], "p", "start");
    press("Enter", { shiftKey: true });
    expect(outline()).toEqual(["paragraph: \nText"]);
  });
});

describe("dividers", () => {
  it('turns "---" into a divider and continues in a paragraph below it', () => {
    const { typeText } = setUp([paragraph("p", "")], "p", "start");
    typeText("---x");
    expect(outline()).toEqual(["divider: ", "paragraph: x"]);
  });

  it('types the third "-" as text when text follows the caret', () => {
    const { typeText } = setUp([paragraph("p", "--abc")], "p", "start");
    selectFromCaret(2);
    typeText("-");
    expect(outline()).toEqual(["paragraph: ---abc"]);
  });
});

describe("Ctrl+End", () => {
  it("puts the caret at the end of the last block's text", () => {
    const { press, typeText } = setUp(
      [paragraph("a", "First"), paragraph("b", "Last")],
      "a",
      "start",
    );
    press("End", { ctrlKey: true });
    typeText(" line");
    expect(outline()).toEqual(["paragraph: First", "paragraph: Last line"]);
  });
});

describe("Tab", () => {
  it("adds a row from a table's last cell", () => {
    const { press } = setUp([table("t", [["a", "b"]])], "t", "start");
    press("Tab");
    press("Tab");
    const block = editor.document[0]!;
    expect(block.content).toMatchObject({ rows: [{}, {}] });
    expect(caret()).toBe("tableParagraph:@0");
  });

  it("indents the selected lines of a code block, and Shift+Tab outdents them", () => {
    const { press } = setUp(
      [{ id: "code", type: "codeBlock", content: "a\nb\nc" }],
      "code",
      "start",
    );
    selectFromCaret(0, 3);
    press("Tab");
    expect(outline()).toEqual(["codeBlock:   a\n  b\nc"]);
    press("Tab", { shiftKey: true });
    expect(outline()).toEqual(["codeBlock: a\nb\nc"]);
  });
});

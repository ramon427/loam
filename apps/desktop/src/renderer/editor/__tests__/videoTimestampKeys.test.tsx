// @vitest-environment jsdom

import { TextSelection } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";
import { useEffect } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildVideoTimestampHref } from "@loam/shared/notes/noteLinks";

import { BlockNoteEditorView } from "../blocknote/BlockNoteEditorView";
import type { NoteBlockEditor } from "../noteEditorSchema";
import { useNoteEditor } from "../useNoteEditor";

let editor: NoteBlockEditor;

function Note() {
  const noteEditor = useNoteEditor({
    createDecorations: () => DecorationSet.empty,
    initialContent: [
      {
        type: "paragraph",
        content: [
          "Watch ",
          { type: "link", href: buildVideoTimestampHref(83), content: "1:23" },
          " now",
        ],
      },
    ],
    uploadFile: vi.fn(),
  });
  useEffect(() => {
    editor = noteEditor;
  }, [noteEditor]);
  return <BlockNoteEditorView editor={noteEditor} theme="light" />;
}

const paragraphText = () => {
  const { content } = editor.document[0]!;
  return Array.isArray(content)
    ? content.map((item) => (item.type === "link" ? `[${item.href}]` : item.text)).join("")
    : "";
};

/** Puts the caret `offset` characters into the paragraph's text. */
const placeCaret = (offset: number) => {
  const view = editor.prosemirrorView!;
  let start = 0;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph") return true;
    start = pos + 1;
    return false;
  });
  act(() => {
    view.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start + offset)));
  });
};

describe("video timestamps while typing", () => {
  it("removes a timestamp whole with Backspace right after it", () => {
    const { container } = render(<Note />);
    placeCaret("Watch 1:23".length);

    fireEvent.keyDown(container.querySelector(".ProseMirror")!, { key: "Backspace" });

    expect(paragraphText()).toBe("Watch  now");
  });

  it("removes a timestamp whole with Delete right before it", () => {
    const { container } = render(<Note />);
    placeCaret("Watch ".length);

    fireEvent.keyDown(container.querySelector(".ProseMirror")!, { key: "Delete" });

    expect(paragraphText()).toBe("Watch  now");
  });
});

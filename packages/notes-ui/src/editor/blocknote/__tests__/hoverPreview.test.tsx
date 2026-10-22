// @vitest-environment jsdom

import { undoDepth } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";
import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DecorationSet } from "@tiptap/pm/view";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { useNoteEditor } from "../../useNoteEditor";
import { BlockNoteEditorView } from "../BlockNoteEditorView";
import { clearHoverPreview, showHoverPreview } from "../hoverPreview";

beforeAll(() => {
  // jsdom has no layout; floating menus only need some rectangle to anchor to.
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => Object.assign([], { item: () => null });
});

let editor: ReturnType<typeof useNoteEditor>;

function Note() {
  const noteEditor = useNoteEditor({
    createDecorations: () => DecorationSet.empty,
    initialContent: [
      {
        id: "mixed",
        type: "paragraph",
        content: [
          { type: "text", text: "red", styles: { textColor: "red" } },
          { type: "text", text: " plain ", styles: {} },
          { type: "text", text: "blue", styles: { textColor: "blue" } },
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

const selectParagraphText = () => {
  const view = editor.prosemirrorView!;
  let from = 0;
  let to = 0;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph") return true;
    from = pos + 1;
    to = pos + node.nodeSize - 1;
    return false;
  });
  act(() => {
    view.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  });
};

const openToolbarMenu = async (trigger: string) => {
  const button = await waitFor(() => {
    const element = document.querySelector<HTMLElement>(
      `.bn-formatting-toolbar [data-test="${trigger}"]`,
    );
    expect(element).toBeTruthy();
    return element!;
  });
  fireEvent.keyDown(button.closest("button") ?? button, { key: "Enter" });
};

const textColors = () => {
  const { content } = editor.document[0]!;
  return Array.isArray(content)
    ? content.map((item) => (item.type === "text" ? item.styles.textColor : undefined))
    : [];
};

describe("formatting toolbar hover previews", () => {
  it("show a hovered text color without editing the note", async () => {
    render(<Note />);
    selectParagraphText();
    const onChange = vi.fn();
    editor.onChange(onChange);
    const depthBefore = undoDepth(editor.prosemirrorView!.state);

    await openToolbarMenu("colors");
    const green = await screen.findByText(
      (_, element) => element?.getAttribute("data-test") === "text-color-green",
    );
    fireEvent.pointerOver(green);

    const paragraph = document.querySelector('[data-content-type="paragraph"]')!;
    const previewed = [...paragraph.querySelectorAll('[data-text-color="green"]')].map(
      (span) => span.textContent,
    );
    expect(previewed.join("")).toBe("red plain blue");

    fireEvent.pointerLeave(green);
    fireEvent.pointerOver(document.body);

    expect(paragraph.querySelector('[data-text-color="green"]')).toBeNull();
    expect(textColors()).toEqual(["red", undefined, "blue"]);
    expect(undoDepth(editor.prosemirrorView!.state)).toBe(depthBefore);
    expect(onChange).not.toHaveBeenCalled();

    // Clicking is what edits the note.
    fireEvent.click(green);
    await waitFor(() => expect(textColors()).toEqual(["green"]));
    expect(undoDepth(editor.prosemirrorView!.state)).toBe(depthBefore + 1);
    expect(onChange).toHaveBeenCalled();
  });

  it("show a hovered alignment without editing the note", async () => {
    render(<Note />);
    selectParagraphText();
    const onChange = vi.fn();
    editor.onChange(onChange);

    const center = await waitFor(() => {
      const element = document.querySelector<HTMLElement>(
        '.bn-formatting-toolbar [data-test="alignTextCenter"]',
      );
      expect(element).toBeTruthy();
      return element!;
    });
    fireEvent.pointerOver(center);
    const content = document.querySelector<HTMLElement>('[data-content-type="paragraph"]')!;
    expect(content.style.textAlign).toBe("center");

    fireEvent.pointerLeave(center);
    expect(content.style.textAlign).toBe("");
    expect(editor.document[0]!.props).toMatchObject({ textAlignment: "left" });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("block color hover previews", () => {
  it("color the block only while hovered", () => {
    render(<Note />);
    const onChange = vi.fn();
    editor.onChange(onChange);
    const outer = document.querySelector<HTMLElement>('.bn-block-outer[data-id="mixed"]')!;

    act(() =>
      showHoverPreview(editor, {
        kind: "blockColor",
        blockId: "mixed",
        style: "backgroundColor",
        color: "yellow",
      }),
    );
    expect(outer.getAttribute("data-background-color")).toBe("yellow");

    act(() => clearHoverPreview(editor, ["blockColor"]));
    expect(outer.hasAttribute("data-background-color")).toBe(false);
    expect(editor.document[0]!.props).toMatchObject({ backgroundColor: "default" });
    expect(textColors()).toEqual(["red", undefined, "blue"]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stays when a different menu closes", () => {
    render(<Note />);
    const outer = document.querySelector<HTMLElement>('.bn-block-outer[data-id="mixed"]')!;
    act(() =>
      showHoverPreview(editor, {
        kind: "blockColor",
        blockId: "mixed",
        style: "textColor",
        color: "green",
      }),
    );

    // The formatting toolbar unmounting clears only its own previews.
    act(() => clearHoverPreview(editor, ["textColor", "backgroundColor", "alignment"]));
    expect(outer.getAttribute("data-text-color")).toBe("green");
  });
});

// @vitest-environment jsdom

import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DecorationSet } from "@tiptap/pm/view";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { installFakeBridge } from "../../../testing/fakeBridge";
import type { NoteBlockEditor, NotePartialBlock } from "../../noteEditorSchema";
import { useNoteEditor } from "../../useNoteEditor";
import { BlockNoteEditorView } from "../BlockNoteEditorView";

beforeAll(() => {
  // jsdom has no layout; floating menus only need some rectangle to anchor to.
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => Object.assign([], { item: () => null });
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

const threeBlocks: NotePartialBlock[] = [
  { id: "a", type: "paragraph", content: "Alpha" },
  { id: "b", type: "heading", props: { level: 2 }, content: "Beta" },
  { id: "c", type: "paragraph", content: "Gamma" },
];

const renderNote = async (blocks = threeBlocks) => {
  const { container } = render(<Note blocks={blocks} />);
  await waitFor(() => expect(container.querySelector('[data-id="a"]')).not.toBeNull());
  return container;
};

const blockContent = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-id="${id}"] [data-content-type]`)!;

const openBlockMenu = (container: HTMLElement, id: string) =>
  fireEvent.contextMenu(blockContent(container, id), { clientX: 10, clientY: 10 });

const choose = async (name: string) =>
  fireEvent.click(await screen.findByRole("menuitem", { name }));

const isDisabled = async (name: string) =>
  (await screen.findByRole("menuitem", { name })).getAttribute("aria-disabled") === "true";

const openTurnInto = async () => {
  const trigger = await screen.findByRole("menuitem", { name: "Turn into" });
  fireEvent.keyDown(trigger, { key: "ArrowRight" });
  return trigger;
};

const shape = () =>
  editor.document.map((block) =>
    block.type === "heading" ? `${block.type}${block.props.level}` : block.type,
  );
const ids = () => editor.document.map((block) => block.id);

describe("the editor's block menu", () => {
  it("lists the block's actions in order, then the edit commands with their keys", async () => {
    const container = await renderNote();
    openBlockMenu(container, "a");

    const menu = await screen.findByRole("menu", { name: "Block actions" });
    const shown = Array.from(menu.querySelectorAll('[role="menuitem"]'), (item) =>
      item.textContent?.trim(),
    );
    expect(shown).toEqual([
      "Turn into",
      "Add block below",
      "Duplicate block",
      "Move up",
      "Move down",
      "Delete block",
      "UndoCtrl+Z",
      "RedoCtrl+Shift+Z",
      "CutCtrl+X",
      "CopyCtrl+C",
      "PasteCtrl+V",
      "Select allCtrl+A",
    ]);
    // Nothing has changed yet, so there is nothing to undo or redo.
    expect(await isDisabled("Undo")).toBe(true);
    expect(await isDisabled("Redo")).toBe(true);
  });

  it("undoes the last edit from the menu", async () => {
    const container = await renderNote();
    act(() => editor.updateBlock("a", { content: "Alpha changed" }));
    openBlockMenu(container, "a");

    expect(await isDisabled("Undo")).toBe(false);
    await choose("Undo");
    await waitFor(() =>
      expect(editor.getBlock("a")?.content).toEqual([
        expect.objectContaining({ type: "text", text: "Alpha" }),
      ]),
    );
  });

  it("turns a block into another type, as one undo step, and marks the type it has", async () => {
    const container = await renderNote();
    openBlockMenu(container, "b");
    await openTurnInto();

    expect(await isDisabled("Heading 2")).toBe(true);
    await choose("Checklist");
    await waitFor(() => expect(shape()).toEqual(["paragraph", "checkListItem", "paragraph"]));
    expect(editor.getBlock("b")?.content).toEqual([
      expect.objectContaining({ type: "text", text: "Beta" }),
    ]);

    act(() => editor.undo());
    expect(shape()).toEqual(["paragraph", "heading2", "paragraph"]);
  });

  it("turns every selected block into the type, as one undo step", async () => {
    const container = await renderNote();
    act(() => editor.setSelection("a", "c"));
    openBlockMenu(container, "c");
    await openTurnInto();
    await choose("Heading 1");

    await waitFor(() => expect(shape()).toEqual(["heading1", "heading1", "heading1"]));
    act(() => editor.undo());
    expect(shape()).toEqual(["paragraph", "heading2", "paragraph"]);
  });

  it("offers no Turn into, and no image copies, for an image from the web", async () => {
    const container = await renderNote([
      { id: "a", type: "paragraph", content: "Alpha" },
      { id: "img", type: "image", props: { url: "https://example.com/a.png" } },
    ]);
    openBlockMenu(container, "img");
    await screen.findByRole("menuitem", { name: "Duplicate block" });
    expect(screen.queryByRole("menuitem", { name: "Turn into" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Copy image" })).toBeNull();
  });

  it("copies a saved image, or saves a copy of it, after Duplicate", async () => {
    const { invoke } = installFakeBridge({});
    const container = await renderNote([
      { id: "a", type: "paragraph", content: "Alpha" },
      { id: "img", type: "image", props: { url: "3f1c.png" } },
    ]);
    openBlockMenu(container, "img");
    const menu = await screen.findByRole("menu", { name: "Block actions" });
    const names = Array.from(menu.querySelectorAll('[role="menuitem"]'), (item) =>
      item.textContent?.trim(),
    );
    expect(names.slice(0, 4)).toEqual([
      "Add block below",
      "Duplicate block",
      "Copy image",
      "Save image as…",
    ]);

    await choose("Copy image");
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("media.copyImage", { reference: "3f1c.png" }),
    );
    openBlockMenu(container, "img");
    await choose("Save image as…");
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("media.saveImageAs", { reference: "3f1c.png" }),
    );
  });

  it("moves a block up and down, but not past the document's ends", async () => {
    const container = await renderNote();
    openBlockMenu(container, "a");
    expect(await isDisabled("Move up")).toBe(true);
    await choose("Move down");
    await waitFor(() => expect(ids()).toEqual(["b", "a", "c"]));

    openBlockMenu(container, "c");
    expect(await isDisabled("Move down")).toBe(true);
    await choose("Move up");
    await waitFor(() => expect(ids()).toEqual(["b", "c", "a"]));

    act(() => editor.undo());
    expect(ids()).toEqual(["b", "a", "c"]);
  });

  it("moves and deletes the whole selection", async () => {
    const container = await renderNote();
    act(() => editor.setSelection("a", "b"));
    openBlockMenu(container, "b");
    await choose("Move down");
    await waitFor(() => expect(ids()).toEqual(["c", "a", "b"]));

    act(() => editor.setSelection("a", "b"));
    openBlockMenu(container, "a");
    await choose("Delete selected");
    await waitFor(() => expect(ids()).toEqual(["c"]));
  });

  it("duplicates a block below it", async () => {
    const container = await renderNote();
    openBlockMenu(container, "a");
    await choose("Duplicate block");
    await waitFor(() => expect(editor.document).toHaveLength(4));
    expect(editor.document[1]).toMatchObject({ type: "paragraph" });
    expect(editor.document[1]?.id).not.toBe("a");
  });
});

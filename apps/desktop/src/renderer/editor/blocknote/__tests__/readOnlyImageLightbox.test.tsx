// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DecorationSet } from "@tiptap/pm/view";
import { describe, expect, it, vi } from "vitest";

import { useNoteEditor } from "../../useNoteEditor";
import { BlockNoteEditorView } from "../BlockNoteEditorView";

function ReadOnlyNote() {
  const editor = useNoteEditor({
    createDecorations: () => DecorationSet.empty,
    initialContent: [{ type: "image", props: { url: "3f1c.png", name: "Sunset" } }],
    uploadFile: vi.fn(),
  });
  return <BlockNoteEditorView editor={editor} theme="light" editable={false} />;
}

describe("read-only image lightbox", () => {
  it("opens a stored image at full size", async () => {
    const { container } = render(<ReadOnlyNote />);
    const inline = await waitFor(() => {
      const image = container.querySelector<HTMLImageElement>('[data-content-type="image"] img');
      expect(image?.getAttribute("src")).toBe("loam-media://images/3f1c.png");
      return image!;
    });

    fireEvent.click(inline);

    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe("loam-media://images/3f1c.png");
  });
});

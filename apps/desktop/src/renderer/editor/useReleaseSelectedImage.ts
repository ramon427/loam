import { useEffect } from "react";
import { getBlockInfoFromSelection } from "@blocknote/core";

import { mountedEditorDom, type NoteBlockEditor } from "./noteEditorSchema";

// Clicks on the editor's own menus, toolbars and popovers keep the image selected.
const editorChromeSelectors =
  ".bn-toolbar, .bn-formatting-toolbar, .bn-link-toolbar, .bn-action-toolbar, [data-loam-formatting-toolbar-popover], [data-loam-color-menu], [data-loam-block-color-menu], [data-loam-block-type-menu], .bn-popover-content, .bn-menu-dropdown, .bn-side-menu, .bn-drag-handle, .bn-add-block-button, .bn-panel, .bn-tab-panel, .bn-file-input, .bn-text-input, [data-radix-popper-content-wrapper], [data-insert-image-popover]";

const selectedImageBlockId = (editor: NoteBlockEditor) => {
  try {
    const info = getBlockInfoFromSelection(editor.prosemirrorState);
    return info.blockNoteType === "image" ? (info.bnBlock.node.attrs.id as string) : null;
  } catch {
    // The selection isn't inside a block, so no image is selected.
    return null;
  }
};

/** The text block nearest to `blockId` in the document, looking both ways. */
const nearestTextBlockId = (blocks: readonly { id: string; type: string }[], blockId: string) => {
  const start = blocks.findIndex((block) => block.id === blockId);
  const isText = (block: { type: string } | undefined) => block && block.type !== "image";
  for (let offset = 1; offset < blocks.length; offset += 1) {
    const forward = blocks[start + offset];
    if (isText(forward)) return forward!.id;
    const backward = blocks[start - offset];
    if (isText(backward)) return backward!.id;
  }
  return null;
};

/**
 * A click outside the editor moves the cursor off a selected image. BlockNote
 * keeps an image's node selection when the editor loses focus, so the image
 * stays outlined and its toolbar stays open over the note.
 */
export const useReleaseSelectedImage = (editor: NoteBlockEditor) => {
  useEffect(() => {
    const releaseImage = (event: PointerEvent) => {
      if (!editor.isEditable || event.button !== 0) return;
      const editorDom = mountedEditorDom(editor);
      if (!editorDom?.isConnected || document.querySelector(".bn-panel")) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || editorDom.contains(target) || target.closest(editorChromeSelectors)) return;
      const imageBlockId = selectedImageBlockId(editor);
      if (!imageBlockId) return;
      const textBlockId = nearestTextBlockId(editor.document, imageBlockId);
      if (!textBlockId) return;
      editor.setTextCursorPosition(textBlockId, "end");
      editor.blur();
    };
    document.addEventListener("pointerdown", releaseImage, true);
    return () => document.removeEventListener("pointerdown", releaseImage, true);
  }, [editor]);
};

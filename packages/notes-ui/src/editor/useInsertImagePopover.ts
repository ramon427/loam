import { useCallback, useEffect, useState } from "react";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { SuggestionMenu } from "@blocknote/core/extensions";

import { mountedEditorDom, removeEmptyImageBlock, type NoteBlockEditor } from "./noteEditorSchema";

type ImagePopoverTarget = { anchorRect: DOMRect; blockId: string };

const imageBlockIdOf = (button: Element) =>
  button.closest('[data-content-type="image"]')?.closest<HTMLElement>("[data-id]")?.dataset.id;

/**
 * The insert-image popover's state. It opens on an empty image block, either
 * from the slash menu's "Image" item (`insertImageBlock`) or from the block's
 * "Add image" button, which would otherwise open BlockNote's file panel.
 */
export function useInsertImagePopover(editor: NoteBlockEditor) {
  const [target, setTarget] = useState<ImagePopoverTarget | null>(null);

  const openFor = useCallback((button: Element) => {
    const blockId = imageBlockIdOf(button);
    if (blockId) setTarget({ anchorRect: button.getBoundingClientRect(), blockId });
  }, []);

  const closeImagePopover = useCallback(() => setTarget(null), []);

  useEffect(() => {
    const dom = mountedEditorDom(editor);
    if (!dom) return;
    const openFromAddButton = (event: MouseEvent) => {
      const button =
        event.target instanceof Element ? event.target.closest(".bn-add-file-button") : null;
      if (!button || !imageBlockIdOf(button)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openFor(button);
    };
    dom.addEventListener("click", openFromAddButton, true);
    return () => dom.removeEventListener("click", openFromAddButton, true);
  }, [editor, openFor]);

  const insertImageBlock = useCallback(() => {
    editor.getExtension(SuggestionMenu)?.closeMenu();
    const block = insertOrUpdateBlockForSlashMenu(editor, { type: "image" });
    // The block's "Add image" button, the popover's anchor, renders after this task.
    setTimeout(() => {
      const button = mountedEditorDom(editor)?.querySelector(
        `[data-id="${block.id}"] .bn-add-file-button`,
      );
      if (button) openFor(button);
    }, 0);
  }, [editor, openFor]);

  /** Removes the target block if it never got an image, e.g. after a rejected file. */
  const discardPendingImageBlock = useCallback(() => {
    if (target) removeEmptyImageBlock(editor, target.blockId);
  }, [editor, target]);

  /** Puts a saved image's media path into the target block, or below the cursor without one. */
  const insertImage = useCallback(
    (path: string) => {
      const image = { type: "image" as const, props: { url: path } };
      if (target && editor.getBlock(target.blockId)) {
        editor.updateBlock(target.blockId, image);
      } else {
        editor.insertBlocks([image], editor.getTextCursorPosition().block, "after");
      }
    },
    [editor, target],
  );

  return {
    imagePopoverState: { open: target !== null, anchorRect: target?.anchorRect ?? null },
    closeImagePopover,
    discardPendingImageBlock,
    insertImage,
    insertImageBlock,
  };
}

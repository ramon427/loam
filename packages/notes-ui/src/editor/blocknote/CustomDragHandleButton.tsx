import { useCallback, useEffect, type PointerEvent, type SyntheticEvent } from "react";
import { SideMenuExtension } from "@blocknote/core/extensions";
import {
  DragHandleButton,
  useBlockNoteEditor,
  useExtensionState,
  type SideMenuProps,
} from "@blocknote/react";

import { clearHoverPreview, readHoverPreviewControl, showHoverPreview } from "./hoverPreview";

const clearBlockColorPreview = (editor: Parameters<typeof clearHoverPreview>[0]) =>
  clearHoverPreview(editor, ["blockColor"]);

const DRAGGING_CLASS_NAME = "bn-editor-dragging";

export function CustomDragHandleButton(props: SideMenuProps) {
  const editor = useBlockNoteEditor();
  const blockId = useExtensionState(SideMenuExtension, { selector: (state) => state?.block.id });
  useEffect(() => () => clearBlockColorPreview(editor), [editor]);

  // React events bubble through portals, so this hears the handle menu's "Colors" items.
  const previewHoveredBlockColor = (event: PointerEvent) => {
    const control = readHoverPreviewControl(event.target);
    if (control?.kind === "color" && blockId) {
      showHoverPreview(editor, {
        kind: "blockColor",
        blockId,
        style: control.style,
        color: control.color,
      });
    } else clearBlockColorPreview(editor);
  };

  const startDraggingStateFromHandle = useCallback((event: SyntheticEvent<HTMLElement>) => {
    event.currentTarget.ownerDocument.body.classList.add(DRAGGING_CLASS_NAME);
  }, []);
  const clearDraggingStateFromHandle = useCallback((event: SyntheticEvent<HTMLElement>) => {
    event.currentTarget.ownerDocument.body.classList.remove(DRAGGING_CLASS_NAME);
  }, []);

  useEffect(() => {
    const doc = document;
    const clearDraggingState = () => {
      doc.body.classList.remove(DRAGGING_CLASS_NAME);
    };

    doc.addEventListener("pointerup", clearDraggingState, true);
    doc.addEventListener("pointercancel", clearDraggingState, true);
    doc.addEventListener("mouseup", clearDraggingState, true);
    doc.addEventListener("dragend", clearDraggingState, true);
    doc.addEventListener("drop", clearDraggingState, true);
    doc.defaultView?.addEventListener("blur", clearDraggingState);

    return () => {
      doc.removeEventListener("pointerup", clearDraggingState, true);
      doc.removeEventListener("pointercancel", clearDraggingState, true);
      doc.removeEventListener("mouseup", clearDraggingState, true);
      doc.removeEventListener("dragend", clearDraggingState, true);
      doc.removeEventListener("drop", clearDraggingState, true);
      doc.defaultView?.removeEventListener("blur", clearDraggingState);
      clearDraggingState();
    };
  }, []);

  return (
    <span
      onDragEndCapture={clearDraggingStateFromHandle}
      onDragStartCapture={startDraggingStateFromHandle}
      onDropCapture={clearDraggingStateFromHandle}
      onMouseDownCapture={startDraggingStateFromHandle}
      onMouseUpCapture={clearDraggingStateFromHandle}
      onPointerDownCapture={startDraggingStateFromHandle}
      onPointerUpCapture={clearDraggingStateFromHandle}
      onPointerOver={previewHoveredBlockColor}
      onPointerLeave={() => clearBlockColorPreview(editor)}
      onKeyDown={(event) => {
        if (event.key === "Escape") clearBlockColorPreview(editor);
      }}
      style={{ display: "inline-flex" }}
    >
      <DragHandleButton {...props} />
    </span>
  );
}

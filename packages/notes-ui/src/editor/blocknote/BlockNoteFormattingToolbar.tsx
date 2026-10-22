import { useEffect, useMemo, type KeyboardEvent, type PointerEvent } from "react";
import {
  FormattingToolbar,
  FileReplaceButton,
  getFormattingToolbarItems,
  FormattingToolbarController,
  blockTypeSelectItems,
  useBlockNoteEditor,
  useExtensionState,
} from "@blocknote/react";
import { FormattingToolbarExtension } from "@blocknote/core/extensions";

import { FileDownloadButton } from "./FileDownloadButton";
import { EditorFilePanel } from "./EditorFilePanel";
import {
  clearHoverPreview,
  readHoverPreviewControl,
  showHoverPreview,
  type HoverPreview,
} from "./hoverPreview";
import { formattingToolbarFloatingOptions } from "./formattingToolbarOptions";
import { offeredBlockTypeItems } from "../slashMenuModel";

const toolbarPreviews: HoverPreview["kind"][] = ["textColor", "backgroundColor", "alignment"];

function BlockNoteFormattingToolbar() {
  const editor = useBlockNoteEditor();
  const items = useMemo(
    () => offeredBlockTypeItems(blockTypeSelectItems(editor.dictionary), editor.dictionary),
    [editor.dictionary],
  );

  useEffect(() => () => clearHoverPreview(editor, toolbarPreviews), [editor]);

  // React events bubble through portals, so this also hears the color menu's items.
  const handlePointerOver = (event: PointerEvent) => {
    const control = readHoverPreviewControl(event.target);
    if (control?.kind === "alignment") showHoverPreview(editor, control);
    else if (control?.kind === "color") {
      showHoverPreview(editor, { kind: control.style, color: control.color });
    } else clearHoverPreview(editor, toolbarPreviews);
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") clearHoverPreview(editor, toolbarPreviews);
  };

  return (
    <div
      className="contents"
      onPointerOver={handlePointerOver}
      onPointerLeave={() => clearHoverPreview(editor, toolbarPreviews)}
      onKeyDown={handleKeyDown}
    >
      <FormattingToolbar blockTypeSelectItems={items}>
        {getFormattingToolbarItems(items).map((item) => {
          if (item.key === "replaceFileButton") {
            return <FileReplaceButton key={item.key} filePanel={EditorFilePanel} />;
          }
          if (item.key === "fileDownloadButton") {
            return <FileDownloadButton key={item.key} />;
          }
          return item;
        })}
      </FormattingToolbar>
    </div>
  );
}

export function BlockNoteFormattingToolbarController() {
  const show = useExtensionState(FormattingToolbarExtension);
  // Dismissed popovers need no cloned closing DOM or positioning subscription.
  if (!show) return null;
  return (
    <FormattingToolbarController
      floatingUIOptions={formattingToolbarFloatingOptions}
      formattingToolbar={BlockNoteFormattingToolbar}
    />
  );
}

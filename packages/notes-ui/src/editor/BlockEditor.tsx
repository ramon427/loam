import { useEffect, type ReactNode } from "react";

import { BlockNoteEditorView } from "./blocknote/BlockNoteEditorView";
import { InsertImagePopover } from "./blocknote/InsertImagePopover";
import { SlashMenuController } from "./blocknote/SlashMenuController";
import type { FeatureBlockMenuItems } from "./blocknote/BlockMenuItems";
import { rejectNonImageFiles } from "./editorImageOnlyMedia";
import type { NoteBlockEditor } from "./noteEditorSchema";
import type { EditorBlockRange, SlashCommand } from "./slashMenuModel";
import { useEditorSlashMenu } from "./useEditorSlashMenu";
import { useEditorTheme } from "./useEditorTheme";
import { useInsertImagePopover } from "./useInsertImagePopover";

const NO_COMMANDS: readonly SlashCommand[] = [];

/** Stops a paste or drop that carries files, for editors that hold no media. */
const rejectFiles = (event: ClipboardEvent | DragEvent) => {
  const data = "clipboardData" in event ? event.clipboardData : event.dataTransfer;
  if (!data?.files.length) return false;
  event.preventDefault();
  return true;
};

export type BlockEditorProps = {
  /** From `useNoteEditor`, which owns the blocks, uploads and decorations. */
  editor: NoteBlockEditor;
  readOnly?: boolean;
  /** Saves an image chosen in the insert-image popover; resolves to the reference its block stores. */
  uploadFile: (file: File) => Promise<string>;
  /** Which blocks it holds; without media, no files can be dropped or pasted in either. */
  blocks?: EditorBlockRange;
  /** Commands the slash menu offers beside the default blocks; keep the array stable. */
  slashCommands?: readonly SlashCommand[];
  /** Rendered inside BlockNote's context, e.g. more suggestion menus. */
  beforeEditor?: ReactNode;
  featureBlockMenuItems?: FeatureBlockMenuItems;
  linkMenuItems?: (link: { href: string; text: string }) => ReactNode;
  /** The drag handle and add button beside each block; off for small fields. */
  showSideMenu?: boolean;
};

/**
 * Loam's rich-text editor: blocks, formatting toolbar, slash menu, emoji picker and the
 * insert-image popover. A note's page tab is one; an app embedding Loam uses the same
 * editor for its own documents. Only images can be dropped or pasted in as files, and none
 * when `blocks` leaves out media.
 */
export function BlockEditor({
  editor,
  readOnly = false,
  uploadFile,
  blocks = "all",
  slashCommands = NO_COMMANDS,
  beforeEditor,
  featureBlockMenuItems,
  linkMenuItems,
  showSideMenu = true,
}: BlockEditorProps) {
  const theme = useEditorTheme();
  const imagePopover = useInsertImagePopover(editor);
  const { closeImagePopover } = imagePopover;
  const slashMenu = useEditorSlashMenu({
    editor,
    extraItems: slashCommands,
    onInsertImage: imagePopover.insertImageBlock,
    blocks,
  });
  useEffect(() => {
    if (readOnly) closeImagePopover();
  }, [closeImagePopover, readOnly]);

  return (
    <>
      <div
        className="contents"
        onDropCapture={(event) => {
          if (readOnly) return;
          if (
            blocks !== "all"
              ? rejectFiles(event.nativeEvent)
              : rejectNonImageFiles(event.nativeEvent)
          )
            event.stopPropagation();
        }}
        onPasteCapture={(event) => {
          if (readOnly) return;
          if (
            blocks !== "all"
              ? rejectFiles(event.nativeEvent)
              : rejectNonImageFiles(event.nativeEvent)
          )
            event.stopPropagation();
        }}
      >
        <BlockNoteEditorView
          editor={editor}
          theme={theme}
          editable={!readOnly}
          featureBlockMenuItems={featureBlockMenuItems}
          linkMenuItems={linkMenuItems}
          showSideMenu={showSideMenu}
          beforeEditor={
            <>
              <SlashMenuController
                enabled={!readOnly}
                getItems={slashMenu.getSlashItems}
                onItemClick={slashMenu.handleSlashItemClick}
              />
              {beforeEditor}
            </>
          }
        />
      </div>
      {readOnly || blocks !== "all" ? null : (
        <InsertImagePopover
          open={imagePopover.imagePopoverState.open}
          anchorRect={imagePopover.imagePopoverState.anchorRect}
          onOpenChange={(open) => {
            if (!open) closeImagePopover();
          }}
          onInvalidImageInput={imagePopover.discardPendingImageBlock}
          onInsertImage={imagePopover.insertImage}
          onUploadFile={uploadFile}
        />
      )}
    </>
  );
}

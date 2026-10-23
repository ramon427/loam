import {
  useContext,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { BlockNoteView } from "@blocknote/shadcn";
import { SideMenuExtension } from "@blocknote/core/extensions";
import {
  AddBlockButton,
  LinkToolbarController,
  SideMenu,
  SideMenuController,
  useExtensionState,
  type SideMenuProps,
} from "@blocknote/react";
import { UnlinkIcon } from "lucide-react";

import {
  ActionMenuContent,
  ActionMenuItem,
  leaveToNativeMenu,
  snapshotContextSelection,
} from "../../action-menu/ActionMenu";
import { ContextMenu, ContextMenuSeparator, ContextMenuTrigger } from "../../ui/ContextMenu";
import "./blockNoteStyles";
import { mediaSrc } from "../../media/mediaSrc";
import { AttachmentPreviewDialog } from "../../media/AttachmentPreviewDialog";
import type { NoteBlockEditor } from "../noteEditorSchema";
import { BlockMenuItems, safeEditorAction, type FeatureBlockMenuItems } from "./BlockMenuItems";
import { EmojiPickerController } from "./EmojiPickerController";
import { BlockNoteFormattingToolbarController } from "./BlockNoteFormattingToolbar";
import { CustomDragHandleButton } from "./CustomDragHandleButton";
import { EditorPortalContext } from "./EditorPortal";
import { blockNoteComponents } from "./blockNoteComponents";
import { NoteLinkToolbar } from "../NoteLinkToolbar";

// Keep the side menu's closing phase short after ancestor scroll dismisses it.
const sideMenuFloatingOptions = {
  useTransitionStylesProps: { duration: { open: 250, close: 0 } },
  useTransitionStatusProps: { duration: { open: 250, close: 0 } },
};

const EditorSideMenu = (props: SideMenuProps) => (
  <SideMenu {...props}>
    <AddBlockButton />
    <CustomDragHandleButton {...props} />
  </SideMenu>
);

const EditorSideMenuController = () => {
  const show = useExtensionState(SideMenuExtension, {
    selector: (state) => Boolean(state?.show),
  });

  // Even a zero-duration close otherwise clones the menu until a timer runs.
  return show ? (
    <SideMenuController sideMenu={EditorSideMenu} floatingUIOptions={sideMenuFloatingOptions} />
  ) : null;
};

type BlockNoteEditorViewProps = {
  editor: NoteBlockEditor;
  theme: "light" | "dark";
  editable?: boolean;
  /** Rendered inside BlockNote's context, e.g. suggestion menu controllers. */
  beforeEditor?: ReactNode;
  featureBlockMenuItems?: FeatureBlockMenuItems;
  /**
   * Right-click items for a link in the note (`ActionMenuItem`s): where it leads. Without them,
   * links get the native menu.
   */
  linkMenuItems?: (link: { href: string; text: string }) => ReactNode;
  /** The drag handle and add button beside each block; off for small fields. */
  showSideMenu?: boolean;
};

/** What the open menu acts on. */
type OpenMenu =
  | { kind: "blocks"; blockIds: readonly string[]; hasSelectedText: boolean }
  /** `from` is where the link starts, for removing it; null in a read-only note. */
  | { kind: "link"; href: string; text: string; from: number | null };

/** The display URL of the image block under a click, from the block's stored reference. */
const resolveReadOnlyImageSrc = (target: EventTarget | null, editor: NoteBlockEditor) => {
  if (!(target instanceof Element)) return null;
  const blockId = target.closest('[data-content-type="image"]')?.closest<HTMLElement>("[data-id]")
    ?.dataset.id;
  const block = blockId ? editor.getBlock(blockId) : undefined;
  return block?.type === "image" ? mediaSrc(block.props.url) : null;
};

/** Removes the link starting at `from`, keeping its text; nothing if it is gone by now. */
const removeLink = (editor: NoteBlockEditor, from: number) =>
  safeEditorAction(editor, () => {
    if (editor.getLinkMarkAtPos(from + 1)?.from === from) editor.deleteLink(from);
  });

export function BlockNoteEditorView({
  editor,
  theme,
  editable = true,
  beforeEditor,
  featureBlockMenuItems,
  linkMenuItems,
  showSideMenu = true,
}: BlockNoteEditorViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [readOnlyImageSrc, setReadOnlyImageSrc] = useState<string | null>(null);
  const portalTarget = useContext(EditorPortalContext);
  const portalElements = useMemo(
    () => (portalTarget ? { default: portalTarget } : undefined),
    [portalTarget],
  );

  const [menu, setMenu] = useState<OpenMenu | null>(null);

  /**
   * A right-click on a link opens the link menu, in read-only notes too. A right-click on a
   * block of an editable note opens the block menu, acting on the block, or on the whole
   * selection when the block is part of it; an unselected block gets the cursor. Everything
   * else gets the native menu.
   */
  const handleContextMenuCapture = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    const inBlocks = Boolean(
      target && event.currentTarget.contains(target) && target.closest(".ProseMirror"),
    );
    const anchor = target?.closest<HTMLAnchorElement>("a[href]");
    if (anchor && inBlocks && linkMenuItems) {
      const link = editable
        ? editor.getLinkMarkAtPos(editor.prosemirrorView.posAtDOM(anchor, 0) + 1)
        : undefined;
      setMenu({
        kind: "link",
        href: anchor.getAttribute("href") ?? "",
        text: anchor.textContent ?? "",
        from: link?.from ?? null,
      });
      return;
    }
    const blockId = target?.closest<HTMLElement>("[data-id]")?.dataset.id;
    if (!editable || !inBlocks || !blockId || anchor) {
      leaveToNativeMenu(event);
      return;
    }
    const current = editor.getSelection()?.blocks.map((block) => block.id) ?? [];
    const snapshot = snapshotContextSelection(new Set(current), blockId);
    if (!current.includes(blockId)) editor.setTextCursorPosition(blockId);
    setMenu({
      kind: "blocks",
      blockIds: snapshot.ids,
      hasSelectedText: Boolean(window.getSelection()?.toString()),
    });
  };

  const handleReadOnlyImageClick = (event: MouseEvent<HTMLDivElement>) => {
    if (editable) return;
    const src = resolveReadOnlyImageSrc(event.target, editor);
    if (!src) return;
    event.preventDefault();
    event.stopPropagation();
    setReadOnlyImageSrc(src);
  };

  // A dropped file lands at the drop point only once the editor has focus.
  const handleDropCapture = (event: DragEvent<HTMLDivElement>) => {
    if (!editable || !event.dataTransfer.types.includes("Files")) return;
    if (!(event.target instanceof HTMLElement)) return;
    event.target.closest<HTMLElement>(".ProseMirror")?.focus({ preventScroll: true });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={containerRef}
          className="ui-editable-tables"
          onContextMenuCapture={handleContextMenuCapture}
          onClickCapture={handleReadOnlyImageClick}
          onDropCapture={handleDropCapture}
        >
          <BlockNoteView
            editor={editor}
            portalElements={portalElements}
            editable={editable}
            slashMenu={false}
            emojiPicker={false}
            sideMenu={false}
            formattingToolbar={false}
            linkToolbar={false}
            filePanel={false}
            tableHandles={false}
            comments={false}
            theme={theme}
            shadCNComponents={blockNoteComponents}
          >
            {beforeEditor}
            {editable ? (
              <>
                {showSideMenu ? <EditorSideMenuController /> : null}
                <BlockNoteFormattingToolbarController />
                <EmojiPickerController />
                <LinkToolbarController linkToolbar={NoteLinkToolbar} />
              </>
            ) : null}
          </BlockNoteView>
          <AttachmentPreviewDialog
            src={editable ? null : readOnlyImageSrc}
            onClose={() => setReadOnlyImageSrc(null)}
          />
        </div>
      </ContextMenuTrigger>
      <ActionMenuContent aria-label={menu?.kind === "link" ? "Link actions" : "Block actions"}>
        {menu?.kind === "blocks" ? (
          <BlockMenuItems
            editor={editor}
            blockIds={menu.blockIds}
            hasSelectedText={menu.hasSelectedText}
            featureBlockMenuItems={featureBlockMenuItems}
          />
        ) : null}
        {menu?.kind === "link" ? (
          <>
            {linkMenuItems?.(menu)}
            {menu.from !== null ? (
              <>
                <ContextMenuSeparator />
                <ActionMenuItem
                  icon={<UnlinkIcon aria-hidden="true" />}
                  onSelect={() => removeLink(editor, menu.from!)}
                >
                  Remove link
                </ActionMenuItem>
              </>
            ) : null}
          </>
        ) : null}
      </ActionMenuContent>
    </ContextMenu>
  );
}

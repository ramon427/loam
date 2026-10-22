import type { ReactNode } from "react";
import { closeHistory, redoDepth, undoDepth } from "@tiptap/pm/history";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ClipboardIcon,
  ClipboardCopyIcon,
  CopyIcon,
  CopyPlusIcon,
  DownloadIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  PilcrowIcon,
  PlusIcon,
  Redo2Icon,
  Repeat2Icon,
  ScissorsIcon,
  TextQuoteIcon,
  TextSelectIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";

import { ActionMenuItem, ActionMenuSub } from "../../action-menu/ActionMenu";
import { copyImage, saveImageAs } from "../../media/imageCopies";
import { toMediaPath } from "../../media/mediaSrc";
import { ContextMenuSeparator } from "../../ui/ContextMenu";
import type { NoteBlock, NoteBlockEditor, NotePartialBlock } from "../noteEditorSchema";

/**
 * Extra right-click items a feature offers for one block (`ActionMenuItem`s), shown above the
 * editor's own; nothing for a block it has none for.
 */
export type FeatureBlockMenuItems = (block: NoteBlock) => ReactNode;

/** A copy of a block and its children that BlockNote inserts under new ids. */
const copyWithoutIds = (block: NoteBlock): NotePartialBlock => ({
  ...structuredClone(block),
  id: undefined,
  children: block.children.map(copyWithoutIds),
});

/**
 * Runs an edit from a context menu as its own undo step, never merged with an edit
 * just before it. BlockNote rejects some actions for some block types; the menu then does
 * nothing rather than crash the page.
 */
export const safeEditorAction = (editor: NoteBlockEditor, action: () => void) => {
  try {
    editor.transact((tr) => {
      closeHistory(tr);
      action();
    });
  } catch (error) {
    if (import.meta.env.DEV) console.error(error);
  }
};

/** The text block types "Turn into" offers; a heading matches only its own level. */
const turnIntoOptions = [
  { label: "Paragraph", icon: PilcrowIcon, type: "paragraph" },
  { label: "Heading 1", icon: Heading1Icon, type: "heading", level: 1 },
  { label: "Heading 2", icon: Heading2Icon, type: "heading", level: 2 },
  { label: "Heading 3", icon: Heading3Icon, type: "heading", level: 3 },
  { label: "Bulleted list", icon: ListIcon, type: "bulletListItem" },
  { label: "Numbered list", icon: ListOrderedIcon, type: "numberedListItem" },
  { label: "Checklist", icon: ListChecksIcon, type: "checkListItem" },
  { label: "Quote", icon: TextQuoteIcon, type: "quote" },
] as const;

type TurnIntoOption = (typeof turnIntoOptions)[number];

const isOptionOf = (block: NoteBlock, option: TurnIntoOption) =>
  block.type === option.type &&
  (!("level" in option) || (block.type === "heading" && block.props.level === option.level));

const turnInto = (editor: NoteBlockEditor, block: NoteBlock, option: TurnIntoOption) => {
  if (isOptionOf(block, option)) return;
  editor.updateBlock(
    block.id,
    "level" in option ? { type: "heading", props: { level: option.level } } : { type: option.type },
  );
};

/** Runs a text command on the editor's selection, after the menu gave focus back. */
const runTextCommand = (editor: NoteBlockEditor, command: "cut" | "copy") => {
  editor.focus();
  document.execCommand(command);
};

/** Pastes what the clipboard holds, as rich text when it has any. */
const pasteFromClipboard = async (editor: NoteBlockEditor) => {
  editor.focus();
  for (const item of await navigator.clipboard.read()) {
    if (item.types.includes("text/html")) {
      editor.pasteHTML(await (await item.getType("text/html")).text());
      return;
    }
    if (item.types.includes("text/plain")) {
      editor.pasteText(await (await item.getType("text/plain")).text());
      return;
    }
  }
};

/**
 * The block menu: what a right-click on a block (or on the selection it is part of) can do to
 * those blocks, then the editor's edit commands.
 */
export function BlockMenuItems({
  editor,
  blockIds,
  hasSelectedText,
  featureBlockMenuItems,
}: {
  editor: NoteBlockEditor;
  blockIds: readonly string[];
  hasSelectedText: boolean;
  featureBlockMenuItems?: FeatureBlockMenuItems;
}) {
  const blocks = blockIds.flatMap((id) => editor.getBlock(id) ?? []);
  const single = blockIds.length === 1 ? blocks[0] : undefined;
  const first = blocks[0];
  const last = blocks.at(-1);
  const featureItems = single ? featureBlockMenuItems?.(single) : null;
  // Only images saved in the notes can be copied out; a web image has no file here.
  const imagePath = single?.type === "image" ? toMediaPath(single.props.url) : null;
  const hasText =
    blocks.length > 0 &&
    blocks.every((block) => editor.schema.blockSchema[block.type]?.content === "inline");
  // Moving past a nested block's siblings lifts it out of its parent, so only the document's
  // first and last blocks can't move.
  const canMoveUp = Boolean(first && (editor.getPrevBlock(first) || editor.getParentBlock(first)));
  const canMoveDown = Boolean(last && (editor.getNextBlock(last) || editor.getParentBlock(last)));
  // With one block the menu names it; with a selection, BlockNote moves the selected blocks.
  const move = (direction: "up" | "down") =>
    safeEditorAction(editor, () => {
      const target = single?.id;
      if (direction === "up") editor.moveBlocksUp(target);
      else editor.moveBlocksDown(target);
    });
  const selectAll = () => {
    const start = editor.document[0];
    const end = editor.document.at(-1);
    if (start && end) editor.setSelection(start.id, end.id);
  };

  return (
    <>
      {featureItems ? (
        <>
          {featureItems}
          <ContextMenuSeparator />
        </>
      ) : null}
      {hasText ? (
        <ActionMenuSub label="Turn into" icon={<Repeat2Icon aria-hidden="true" />}>
          {turnIntoOptions.map((option) => {
            const Icon = option.icon;
            return (
              <ActionMenuItem
                key={option.label}
                icon={<Icon aria-hidden="true" />}
                disabled={blocks.every((block) => isOptionOf(block, option))}
                onSelect={() =>
                  safeEditorAction(editor, () =>
                    blocks.forEach((block) => turnInto(editor, block, option)),
                  )
                }
              >
                {option.label}
              </ActionMenuItem>
            );
          })}
        </ActionMenuSub>
      ) : null}
      {single ? (
        <ActionMenuItem
          icon={<PlusIcon aria-hidden="true" />}
          onSelect={() =>
            safeEditorAction(editor, () =>
              editor.insertBlocks([{ type: "paragraph" }], single.id, "after"),
            )
          }
        >
          Add block below
        </ActionMenuItem>
      ) : null}
      <ActionMenuItem
        icon={<CopyPlusIcon aria-hidden="true" />}
        disabled={blocks.length === 0}
        onSelect={() =>
          safeEditorAction(editor, () =>
            editor.insertBlocks(blocks.map(copyWithoutIds), blockIds.at(-1)!, "after"),
          )
        }
      >
        {single ? "Duplicate block" : "Duplicate selected"}
      </ActionMenuItem>
      {imagePath ? (
        <>
          <ActionMenuItem
            icon={<ClipboardCopyIcon aria-hidden="true" />}
            onSelect={() => void copyImage(imagePath)}
          >
            Copy image
          </ActionMenuItem>
          <ActionMenuItem
            icon={<DownloadIcon aria-hidden="true" />}
            onSelect={() => void saveImageAs(imagePath)}
          >
            Save image as…
          </ActionMenuItem>
        </>
      ) : null}
      <ActionMenuItem
        icon={<ArrowUpIcon aria-hidden="true" />}
        disabled={!canMoveUp}
        onSelect={() => move("up")}
      >
        Move up
      </ActionMenuItem>
      <ActionMenuItem
        icon={<ArrowDownIcon aria-hidden="true" />}
        disabled={!canMoveDown}
        onSelect={() => move("down")}
      >
        Move down
      </ActionMenuItem>
      <ContextMenuSeparator />
      <ActionMenuItem
        icon={<Trash2Icon aria-hidden="true" />}
        destructive
        onSelect={() => safeEditorAction(editor, () => editor.removeBlocks([...blockIds]))}
      >
        {single ? "Delete block" : "Delete selected"}
      </ActionMenuItem>
      <ContextMenuSeparator />
      <ActionMenuItem
        icon={<Undo2Icon aria-hidden="true" />}
        shortcut="edit.undo"
        disabled={undoDepth(editor.prosemirrorState) === 0}
        onSelect={() => editor.undo()}
      >
        Undo
      </ActionMenuItem>
      <ActionMenuItem
        icon={<Redo2Icon aria-hidden="true" />}
        shortcut="edit.redo"
        disabled={redoDepth(editor.prosemirrorState) === 0}
        onSelect={() => editor.redo()}
      >
        Redo
      </ActionMenuItem>
      <ActionMenuItem
        icon={<ScissorsIcon aria-hidden="true" />}
        shortcut="edit.cut"
        disabled={!hasSelectedText}
        onSelect={() => runTextCommand(editor, "cut")}
      >
        Cut
      </ActionMenuItem>
      <ActionMenuItem
        icon={<CopyIcon aria-hidden="true" />}
        shortcut="edit.copy"
        disabled={!hasSelectedText}
        onSelect={() => runTextCommand(editor, "copy")}
      >
        Copy
      </ActionMenuItem>
      <ActionMenuItem
        icon={<ClipboardIcon aria-hidden="true" />}
        shortcut="edit.paste"
        onSelect={() => void pasteFromClipboard(editor)}
      >
        Paste
      </ActionMenuItem>
      <ActionMenuItem
        icon={<TextSelectIcon aria-hidden="true" />}
        shortcut="edit.select-all"
        onSelect={selectAll}
      >
        Select all
      </ActionMenuItem>
    </>
  );
}

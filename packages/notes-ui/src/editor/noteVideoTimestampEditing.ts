import type { BlockNoteEditor } from "@blocknote/core";
import { TextSelection } from "@tiptap/pm/state";

import { readVideoTimestampHref } from "@loam/shared/notes/noteLinks";

/*
 * A video timestamp in a note is a link that behaves as one chip: a click
 * selects all of it, and Backspace or Delete removes it whole.
 */

type TimestampEditor = Pick<
  BlockNoteEditor,
  "isEditable" | "getLinkMarkAtPos" | "transact" | "focus" | "prosemirrorView" | "prosemirrorState"
>;

type LinkRange = { from: number; to: number; href: string };

const asTimestamp = (link: LinkRange | undefined) =>
  link && link.to > link.from && readVideoTimestampHref(link.href) !== null ? link : undefined;

/** The timestamp Backspace or Delete removes whole, or null to edit text as usual. */
export const resolveVideoTimestampLinkForKey = ({
  key,
  selectionFrom,
  selectionTo,
  getLinkAt,
}: {
  key: "Backspace" | "Delete";
  selectionFrom: number;
  selectionTo: number;
  getLinkAt: (position: number) => LinkRange | undefined;
}): LinkRange | null => {
  const from = Math.min(selectionFrom, selectionTo);
  const to = Math.max(selectionFrom, selectionTo);

  if (from !== to) {
    const startLink = asTimestamp(getLinkAt(from));
    if (startLink && from >= startLink.from && to <= startLink.to) return startLink;
    const endLink = asTimestamp(getLinkAt(Math.max(from, to - 1)));
    if (endLink && from >= endLink.from && to <= endLink.to) return endLink;
    return null;
  }

  if (key === "Backspace") {
    if (from === 0) return null;
    const behind = asTimestamp(getLinkAt(from - 1));
    // The caret is inside the chip or right after it, never before it.
    return behind && from > behind.from ? behind : null;
  }

  const atCaret = asTimestamp(getLinkAt(from));
  if (atCaret && from < atCaret.to) return atCaret;
  const next = asTimestamp(getLinkAt(from + 1));
  return next && from === next.from ? next : null;
};

/** Selects the whole timestamp a click landed on. */
export const selectVideoTimestampLink = (editor: TimestampEditor, anchor: HTMLAnchorElement) => {
  if (!editor.isEditable) return;
  const link = asTimestamp(editor.getLinkMarkAtPos(editor.prosemirrorView.posAtDOM(anchor, 0) + 1));
  if (!link) return;
  editor.transact((tr) => tr.setSelection(TextSelection.create(tr.doc, link.from, link.to)));
  editor.focus();
};

/** Removes the timestamp at the selection whole; false when there is none to remove. */
export const deleteVideoTimestampForKey = (
  editor: TimestampEditor,
  key: "Backspace" | "Delete",
) => {
  if (!editor.isEditable) return false;
  const { from, to } = editor.prosemirrorState.selection;
  const range = resolveVideoTimestampLinkForKey({
    key,
    selectionFrom: from,
    selectionTo: to,
    getLinkAt: (position) => editor.getLinkMarkAtPos(position),
  });
  if (!range) return false;
  editor.transact((tr) => tr.delete(range.from, range.to));
  return true;
};

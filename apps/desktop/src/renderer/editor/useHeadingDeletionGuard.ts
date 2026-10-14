import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Transaction } from "@tiptap/pm/state";

import { toastError } from "../ui/toast";
import type { NoteBlockChanges, NoteBlockEditor, NotePartialBlock } from "./noteEditorSchema";

import type { HeadingConnections } from "@loam/shared/notes/headingConnections";

import type { NoteDocument } from "../workspace/types";
import {
  captureNoteHeadingConnections,
  disconnectNoteHeadings,
  isNoteHeadingBlock,
  listNoteHeadingConnectionTargets,
  restoreNoteHeadingConnections,
  type NoteHeadingConnectionSnapshot,
} from "./noteHeadingConnections";

/** Marks a confirmed deletion, so the guard lets it through. */
const CONFIRMED = "loam.heading-deletion-confirmed";

/** A deletion that removes headings graph nodes or table rows link to, waiting for the user. */
export type PendingHeadingDeletion = {
  action: "delete" | "convert" | "change";
  headingBlockIds: string[];
  transaction: Transaction;
};

/** Heading links that removed headings take with them, kept so undo can bring them back. */
export type HeadingTombstones = Map<string, NoteHeadingConnectionSnapshot[]>;

const headingIdsIn = (block: NotePartialBlock | undefined): string[] =>
  block
    ? [
        ...(isNoteHeadingBlock(block) ? [block.id] : []),
        ...(block.children ?? []).flatMap(headingIdsIn),
      ]
    : [];

/** Headings a change removes, by deleting them or turning them into other blocks. */
const removedHeadingIds = (changes: NoteBlockChanges) => [
  ...new Set(
    changes.flatMap((change) => {
      if (change.type === "delete") return headingIdsIn(change.block);
      if (change.type !== "update") return [];
      const kept = new Set(headingIdsIn(change.block));
      return headingIdsIn(change.prevBlock).filter((id) => !kept.has(id));
    }),
  ),
];

/** Headings a change brings back, as undo does. */
const restoredHeadingIds = (changes: NoteBlockChanges) => [
  ...new Set(
    changes.flatMap((change) => {
      if (change.type === "insert") return headingIdsIn(change.block);
      if (change.type !== "update") return [];
      const had = new Set(headingIdsIn(change.prevBlock));
      return headingIdsIn(change.block).filter((id) => !had.has(id));
    }),
  ),
];

/**
 * Asks before an edit removes headings that graph nodes or table rows link
 * to, then unlinks them. Undo restores the links with the headings, and redo
 * removes them again without asking.
 */
export function useHeadingDeletionGuard(
  editor: NoteBlockEditor,
  note: NoteDocument,
  readOnly: boolean,
) {
  const [pending, setPending] = useState<PendingHeadingDeletion | null>(null);
  const pendingRef = useRef<PendingHeadingDeletion | null>(null);
  const noteRef = useRef(note);
  useLayoutEffect(() => {
    noteRef.current = note;
  });
  /** What the change being made does to heading links, read by the change that follows. */
  const linkChange = useRef<
    | { type: "disconnect"; headingBlockIds: string[] }
    | { type: "restore"; snapshots: NoteHeadingConnectionSnapshot[] }
    | null
  >(null);
  const [tombstones] = useState<HeadingTombstones>(() => new Map());

  useEffect(() => {
    if (readOnly) return;
    return editor.onBeforeChange(({ getChanges, tr }) => {
      if (tr.getMeta(CONFIRMED) === true) return;
      const changes = getChanges();
      const sources = new Set(changes.map((change) => change.source.type));
      const isUndo = sources.has("undo") || sources.has("undo-redo");
      const isRedo = sources.has("redo") || sources.has("undo-redo");
      if (isUndo) {
        const snapshots = restoredHeadingIds(changes).flatMap((id) => tombstones.get(id) ?? []);
        if (snapshots.length > 0) linkChange.current = { type: "restore", snapshots };
      }
      const linked = new Set(
        listNoteHeadingConnectionTargets(noteRef.current).flatMap(
          (target) => target.headingBlockIds,
        ),
      );
      const removed = removedHeadingIds(changes).filter((id) => linked.has(id));
      if (removed.length === 0) return;
      if (isRedo && removed.every((id) => tombstones.has(id))) {
        linkChange.current = { type: "disconnect", headingBlockIds: removed };
        return;
      }
      if (pendingRef.current) return false;
      const deleted = changes.some(
        (change) =>
          change.type === "delete" &&
          isNoteHeadingBlock(change.block) &&
          removed.includes(change.block.id),
      );
      const converted = changes.some(
        (change) =>
          change.type === "update" &&
          isNoteHeadingBlock(change.prevBlock) &&
          !isNoteHeadingBlock(change.block) &&
          removed.includes(change.prevBlock.id),
      );
      let action: PendingHeadingDeletion["action"] = "delete";
      if (deleted && converted) action = "change";
      else if (converted) action = "convert";
      pendingRef.current = { action, headingBlockIds: removed, transaction: tr };
      setPending(pendingRef.current);
      return false;
    });
  }, [editor, readOnly, tombstones]);

  const cancel = useCallback(() => {
    pendingRef.current = null;
    setPending(null);
  }, []);

  /** Makes the held-back edit, unlinking its headings, unless the note changed meanwhile. */
  const confirm = useCallback(() => {
    const deletion = pendingRef.current;
    cancel();
    if (!deletion) return;
    const snapshots = captureNoteHeadingConnections(noteRef.current, deletion.headingBlockIds);
    linkChange.current = { type: "disconnect", headingBlockIds: deletion.headingBlockIds };
    deletion.transaction.setMeta(CONFIRMED, true);
    let dispatched = false;
    try {
      editor.exec((state, dispatch) => {
        if (!dispatch || !state.doc.eq(deletion.transaction.before)) return false;
        dispatch(deletion.transaction);
        dispatched = true;
        return true;
      });
    } catch {
      linkChange.current = null;
      toastError("The heading could not be deleted. Try again.");
      return;
    }
    if (!dispatched) {
      linkChange.current = null;
      toastError("The note changed while confirmation was open. Try deleting the heading again.");
      return;
    }
    for (const id of deletion.headingBlockIds) {
      const own = snapshots.filter((snapshot) => snapshot.headingBlockId === id);
      if (own.length > 0) tombstones.set(id, own);
    }
  }, [cancel, editor, tombstones]);

  /** The link changes the latest edit carries, for the note as that edit leaves it. */
  const takeLinkChange = useCallback((edited: NoteDocument): Partial<HeadingConnections> => {
    const change = linkChange.current;
    linkChange.current = null;
    if (!change) return {};
    return change.type === "disconnect"
      ? disconnectNoteHeadings(edited, change.headingBlockIds)
      : restoreNoteHeadingConnections(edited, change.snapshots);
  }, []);

  return { pending, confirm, cancel, takeLinkChange, tombstones };
}

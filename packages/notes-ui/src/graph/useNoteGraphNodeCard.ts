import { type OnResize, type OnResizeEnd } from "@xyflow/react";
import { useReducedMotion } from "framer-motion";
import { useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  estimateNoteGraphNodeSize,
  getNoteGraphNodeSize,
} from "@loam/shared/notes/noteGraphGeometry";
import type { NoteGraphNode, NoteGraphNodeSize } from "@loam/shared/notes/noteModel";

import { snapNoteGraphNodeSizeToGrid } from "./noteGraphGeometry";
import { NoteGraphNodeActionsContext } from "./noteGraphNodeActions";

/** A draft of one field while it is edited on the canvas. */
export type NoteGraphNodeDraft = {
  value: string;
  set: (value: string) => void;
  commit: () => void;
  /** Drops the draft and leaves editing. */
  cancel: () => void;
  /** Tab saves the draft and adds a connected child; Shift+Tab adds a sibling. */
  chain: (event: KeyboardEvent) => void;
};

/** A field's draft, reset to the saved value whenever that value changes. */
function useDraft(saved: string) {
  const [state, setState] = useState({ source: saved, value: saved });
  const value = state.source === saved ? state.value : saved;
  const set = useCallback((next: string) => setState({ source: saved, value: next }), [saved]);
  const reset = useCallback(() => setState({ source: saved, value: saved }), [saved]);
  return { value, set, reset };
}

/** Live and briefly-shown sizes while a node is resized, and fitting it to its content. */
function useNodeResize(node: NoteGraphNode, canResize: boolean) {
  const actions = useContext(NoteGraphNodeActionsContext);
  const [liveSize, setLiveSize] = useState<NoteGraphNodeSize | null>(null);
  const [flashSize, setFlashSize] = useState<NoteGraphNodeSize | null>(null);
  const committedSize = getNoteGraphNodeSize(node);
  const previousSizeRef = useRef(committedSize);
  const frameRef = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const prefersReducedMotion = useReducedMotion() ?? false;

  // Briefly surface the committed size after keyboard, auto-fit, or undo
  // resizes so the change is visible without an in-progress drag.
  useEffect(() => {
    const previous = previousSizeRef.current;
    previousSizeRef.current = committedSize;
    if (previous.width === committedSize.width && previous.height === committedSize.height) {
      return;
    }
    if (prefersReducedMotion) return;
    setFlashSize(committedSize);
    const timeout = window.setTimeout(() => setFlashSize(null), 900);
    return () => window.clearTimeout(timeout);
  }, [committedSize, prefersReducedMotion]);

  const onResize = useCallback<OnResize>((_, params) => {
    // rAF-throttled: d3-resize fires per mousemove.
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      setLiveSize({ width: params.width, height: params.height });
    });
  }, []);

  const onResizeEnd = useCallback<OnResizeEnd>(
    (_, params) => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      setLiveSize(null);
      actions?.resizeNode(node.id, params);
    },
    [actions, node.id],
  );

  useEffect(() => {
    const card = cardRef.current;
    if (!card || !canResize) return;
    // Capture on the card so the double click stops here: React Flow and d3-zoom never see
    // it, and neither does the card's own double click, which would start editing.
    const fitOnCornerDoubleClick = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest(".react-flow__resize-control.handle")) return;
      event.preventDefault();
      event.stopPropagation();
      actions?.resizeNode(node.id, estimateNoteGraphNodeSize(node));
    };
    card.addEventListener("dblclick", fitOnCornerDoubleClick, true);
    return () => card.removeEventListener("dblclick", fitOnCornerDoubleClick, true);
  }, [actions, canResize, node]);

  return {
    cardRef,
    onResize,
    onResizeEnd,
    badgeSize: liveSize ? snapNoteGraphNodeSizeToGrid(liveSize) : flashSize,
  };
}

/** A node card's editing state and resize handling, shared by the card's parts. */
export function useNoteGraphNodeCard(node: NoteGraphNode) {
  const actions = useContext(NoteGraphNodeActionsContext);
  const shape = node.shape ?? "process";
  const editable = Boolean(actions) && !actions?.readOnly && !node.locked;
  const title = useDraft(node.title);
  const text = useDraft(node.notes ?? "");
  const [draftRequestId, setDraftRequestId] = useState<number | null>(null);

  // The canvas decides which node is being edited; each new edit starts from the saved text.
  const titleEdit =
    actions?.titleEdit?.nodeId === node.id && editable && shape !== "image"
      ? actions.titleEdit
      : null;
  if (titleEdit && titleEdit.requestId !== draftRequestId) {
    setDraftRequestId(titleEdit.requestId);
    title.reset();
    text.reset();
  }
  const setEditing = (on: boolean) => {
    if (on) actions?.beginTitleEdit(node.id);
    else actions?.endTitleEdit(node.id);
  };

  const draft = (
    reset: () => void,
    patch: () => Partial<NoteGraphNode>,
  ): Omit<NoteGraphNodeDraft, "value" | "set"> => ({
    commit: () => {
      setEditing(false);
      actions?.updateNode(node.id, patch());
    },
    cancel: () => {
      reset();
      setEditing(false);
    },
    chain: (event) => {
      event.preventDefault();
      setEditing(false);
      actions?.chainFromNode(node.id, event.shiftKey ? "sibling" : "child", patch());
    },
  });

  /** Text objects grow with their content instead of clipping. */
  const textPatch = () => {
    const notes = text.value.trim() || undefined;
    const size = getNoteGraphNodeSize(node);
    const estimated = estimateNoteGraphNodeSize({ title: notes ?? "Text", shape: "text" });
    const height = Math.max(estimated.height, size.height);
    return {
      notes,
      ...(height !== size.height
        ? { size: snapNoteGraphNodeSizeToGrid({ width: size.width, height }) }
        : {}),
    };
  };

  const titleDraft: NoteGraphNodeDraft = {
    value: title.value,
    set: title.set,
    ...draft(title.reset, () => ({ title: title.value.trim() || "Untitled node" })),
  };
  const textEdit = draft(text.reset, textPatch);
  // A text object left without text goes, so a stray double-click leaves nothing behind.
  const textDraft: NoteGraphNodeDraft = {
    value: text.value,
    set: text.set,
    ...textEdit,
    commit: () => {
      if (text.value.trim()) textEdit.commit();
      else {
        setEditing(false);
        actions?.removeEmptyText(node.id);
      }
    },
    cancel: () => {
      textEdit.cancel();
      if (!node.notes?.trim()) actions?.removeEmptyText(node.id);
    },
  };

  const { cardRef, onResize, onResizeEnd, badgeSize } = useNodeResize(
    node,
    editable && shape !== "image",
  );
  return {
    actions,
    editable,
    editing: titleEdit !== null,
    setEditing,
    titleDraft,
    textDraft,
    cardRef,
    onResize,
    onResizeEnd,
    badgeSize,
  };
}

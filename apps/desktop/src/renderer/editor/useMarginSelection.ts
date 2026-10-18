import { useEffect } from "react";
import { Selection, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { mountedEditorDom, type NoteBlockEditor } from "./noteEditorSchema";

/** The note's page around the paper, which also holds the paper's tabs and handles. */
const CANVAS_SELECTOR = "[data-notes-document-mode]";
/** The canvas's backdrop, behind the paper. */
const BACKDROP_SELECTOR = "[data-text-margin]";

/** The document position nearest to a point outside the text, as a text editor picks it. */
const nearestPosition = (view: EditorView, x: number, y: number) => {
  const blocks = view.dom.querySelector(":scope > .bn-block-group") ?? view.dom;
  const rect = blocks.getBoundingClientRect();
  if (y < rect.top) return Selection.atStart(view.state.doc).from;
  if (y > rect.bottom) return Selection.atEnd(view.state.doc).from;
  const left = Math.min(Math.max(x, rect.left + 1), rect.right - 1);
  return view.posAtCoords({ left, top: y })?.pos ?? null;
};

const select = (view: EditorView, anchor: number, head: number) => {
  const { doc } = view.state;
  const selection = TextSelection.between(doc.resolve(anchor), doc.resolve(head));
  if (!selection.eq(view.state.selection)) {
    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
  }
};

/**
 * A press in the margins around the note's text (the canvas, the paper's edges, the space below
 * the last block) puts the caret at the nearest text, and a drag from there selects text, as in
 * a word processor. Left to the browser, the press lands on no text, and a drag selects from the
 * first text it finds in the page order: the note's tabs and breadcrumbs, then the whole body.
 */
export const useMarginSelection = (editor: NoteBlockEditor) => {
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || event.defaultPrevented || !editor.isEditable) return;
      const editorDom = mountedEditorDom(editor);
      const canvas = editorDom?.isConnected ? editorDom.closest(CANVAS_SELECTOR) : null;
      const target = event.target instanceof Element ? event.target : null;
      if (!editorDom || !canvas || !target || !canvas.contains(target)) return;
      // Only the page's own layers: the paper's tabs, handles and side column keep their presses.
      const isMargin =
        (target !== editorDom && target.contains(editorDom)) ||
        Boolean(target.closest(BACKDROP_SELECTOR));
      if (!isMargin) return;
      const view = editor.prosemirrorView;
      event.preventDefault();
      // A double or triple press there picks no word or line.
      if (event.detail > 1) return;
      const pressed = nearestPosition(view, event.clientX, event.clientY);
      if (pressed === null) return;
      const anchor = event.shiftKey ? view.state.selection.anchor : pressed;
      view.focus();
      select(view, anchor, pressed);
      const extend = (move: MouseEvent) => {
        const head = nearestPosition(view, move.clientX, move.clientY);
        if (head !== null && !view.isDestroyed) select(view, anchor, head);
      };
      const finish = () => {
        window.removeEventListener("mousemove", extend);
        window.removeEventListener("mouseup", finish);
      };
      window.addEventListener("mousemove", extend);
      window.addEventListener("mouseup", finish);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [editor]);
};

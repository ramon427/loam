import { useEffect, useRef, useState } from "react";

import { useCreateBlockNote } from "@blocknote/react";
import type { EditorState } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";

import { isEditorLink } from "@loam/shared/notes/noteLinks";

import { hoverPreviewExtension } from "./blocknote/hoverPreview";
import { columnEditingExtension, handleColumnDrop } from "./columnEditing";
import { columnDropCursorHooks } from "./columns/columnDropTarget";
import { columnResizeExtension } from "./columns/columnResize";
import { createDefaultBlocks } from "./blocknote/editorTabTemplates";
import { useReleaseSelectedImage } from "./useReleaseSelectedImage";
import { handleNoteEditorKeyDown, handleNoteEditorTextInput } from "./editorKeyRules";
import { handleEditorLinkClick } from "./editorLinks";
import { handleEditorPaste } from "./editorPaste";
import {
  mountedEditorDom,
  noteEditorSchema,
  type NoteBlockEditor,
  type NotePartialBlock,
  removeEmptyImageBlock,
} from "./noteEditorSchema";
import { mediaSrc } from "../media/mediaSrc";

type UseNoteEditorOptions = {
  /** Extra decorations, e.g. heading connection badges; redrawn when the function changes. */
  createDecorations: (state: EditorState) => DecorationSet;
  initialContent: NotePartialBlock[];
  /** Saves a file and resolves to the reference its block stores (a media path). */
  uploadFile: (file: File) => Promise<string>;
};

/** Creates the note editor: its schema, paste and key rules, uploads and media URLs. */
export function useNoteEditor({
  createDecorations,
  initialContent,
  uploadFile,
}: UseNoteEditorOptions) {
  // BlockNote reads its options once, so callbacks that change are read through refs.
  const createDecorationsRef = useRef(createDecorations);
  const uploadFileRef = useRef(uploadFile);
  useEffect(() => {
    createDecorationsRef.current = createDecorations;
    uploadFileRef.current = uploadFile;
  }, [createDecorations, uploadFile]);

  // BlockNote rejects an empty initialContent, and a page tab has no blocks
  // until its first edit is saved, so it starts from one empty paragraph.
  const [stableInitialContent] = useState(() =>
    initialContent.length > 0 ? initialContent : createDefaultBlocks(),
  );

  const editor: NoteBlockEditor = useCreateBlockNote({
    schema: noteEditorSchema,
    extensions: [hoverPreviewExtension, columnEditingExtension, columnResizeExtension],
    // BlockNote reads initialContent once. When a tab's blocks change outside the
    // editor, the note view remounts it under a new key so it starts from them.
    initialContent: stableInitialContent,
    dropCursor: { hooks: columnDropCursorHooks, width: 2, color: "var(--app-accent)" },
    uploadFile: async (file, blockId) => {
      try {
        return await uploadFileRef.current(file);
      } catch (error) {
        if (blockId) removeEmptyImageBlock(editor, blockId);
        throw error;
      }
    },
    // Blocks store media paths; BlockNote asks for a loadable URL when it renders one.
    resolveFileUrl: async (url) => mediaSrc(url) ?? "",
    links: { onClick: handleEditorLinkClick, isValidLink: isEditorLink },
    pasteHandler: handleEditorPaste,
    _tiptapOptions: {
      editorProps: {
        // Keeps the caret clear of the page's edges while typing scrolls it.
        scrollMargin: { top: 12, bottom: 24, left: 0, right: 0 },
        decorations: (state) =>
          DecorationSet.create(state.doc, createDecorationsRef.current(state).find() ?? []),
        handleTextInput: (view, from, to, text) =>
          handleNoteEditorTextInput(editor, view, from, to, text),
        handleDrop: (view, event, slice, moved) => handleColumnDrop(view, event, slice, moved),
        handleKeyDown: (view, event) => handleNoteEditorKeyDown(editor, view, event),
      },
    },
  });

  useEffect(() => {
    const dom = mountedEditorDom(editor);
    if (!dom) return;
    dom.setAttribute("spellcheck", "false");
    dom.setAttribute("autocorrect", "off");
    const view = editor.prosemirrorView;
    // The decorations prop reruns only on a transaction; an empty one redraws them now.
    try {
      view.dispatch(view.state.tr);
    } catch {
      // A shrinking document can leave the selection past content.size.
    }
  }, [createDecorations, editor]);

  useReleaseSelectedImage(editor);

  return editor;
}

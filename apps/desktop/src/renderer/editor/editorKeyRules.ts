import { SuggestionMenu } from "@blocknote/core/extensions";
import { closeHistory } from "@tiptap/pm/history";
import { Selection, TextSelection } from "@tiptap/pm/state";
import type { Transform } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";

import { matchesShortcut, shortcuts } from "../keyboard/shortcuts";
import { columnKeyRule } from "./columnEditing";
import { typeDividerShortcut } from "./editorBlockInsertion";
import {
  addTableRowOnTab,
  backspaceCodeIntoParagraph,
  backspaceIntoBlockAbove,
  deleteIntoBlockBelow,
  enterAtBlockStart,
  enterAtToggleEnd,
  indentCodeLines,
  removeEmptyBlockOnDelete,
} from "./editorBlockKeys";
import type { NoteBlockEditor } from "./noteEditorSchema";
import { deleteVideoTimestampForKey } from "./noteVideoTimestampEditing";

/**
 * Typing rules the note editor adds on top of BlockNote's, run from its
 * ProseMirror `handleKeyDown` and `handleTextInput` props, which come before
 * BlockNote's keyboard shortcuts and input rules. Each rule returns true when
 * it handled the input.
 */

/** No modifier but Shift, outside IME composition. */
const isPlainKey = (event: KeyboardEvent) =>
  !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing;

const isInCode = (view: EditorView) => {
  const { $from } = view.state.selection;
  return (
    $from.parent.type.name === "codeBlock" || $from.marks().some((m) => m.type.name === "code")
  );
};

/** "->" becomes "→" as the ">" is typed, outside code. */
const replaceTypedArrow = (view: EditorView, from: number, to: number, text: string) => {
  if (text !== ">" || from !== to || from < 1 || isInCode(view)) return false;
  if (view.state.doc.textBetween(from - 1, from, "", "") !== "-") return false;
  view.dispatch(view.state.tr.insertText("→", from - 1, from));
  return true;
};

// BlockNote opens its slash, mention and emoji menus from native text input.
const suggestionTriggers = new Set(["/", "@", ":"]);

/**
 * The first character typed into an empty text block is inserted with a
 * transaction rather than left to the browser: the browser would have to
 * replace the block's placeholder and trailing `<br>` itself, and a first
 * keystroke can be lost while it does.
 */
const insertFirstKeyInEmptyTextBlock = (view: EditorView, event: KeyboardEvent) => {
  if (event.key.length !== 1 || suggestionTriggers.has(event.key) || !isPlainKey(event)) {
    return false;
  }
  const { selection } = view.state;
  const block = selection.$from.parent;
  if (!selection.empty || !block.isTextblock || block.content.size > 0) return false;
  view.dispatch(view.state.tr.insertText(event.key, selection.from, selection.to));
  return true;
};

/**
 * Ctrl/Cmd+End puts the caret at the end of the last block's text. Left to the
 * browser, it lands after BlockNote's trailing-block widget, outside every
 * block, and the next character typed is lost.
 */
const moveCaretToNoteEnd = (view: EditorView, event: KeyboardEvent) => {
  if (event.key !== "End" || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) {
    return false;
  }
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)).scrollIntoView());
  return true;
};

/**
 * Ctrl/Cmd+A first selects the text of the block the caret is in, and a second press the whole
 * note, as in Notion: one press selecting a long note is easy to do by accident and costly to
 * act on. An empty block, or one already selected whole, goes straight to the whole note.
 */
const selectBlockTextFirst = (view: EditorView, event: KeyboardEvent) => {
  if (!matchesShortcut(event, shortcuts["edit.select-all"])) return false;
  const { selection } = view.state;
  const { $from, $to } = selection;
  if (
    !(selection instanceof TextSelection) ||
    !$from.sameParent($to) ||
    !$from.parent.isTextblock
  ) {
    return false;
  }
  const start = $from.start();
  const end = $from.end();
  if (start === end || (selection.from === start && selection.to === end)) return false;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start, end)));
  return true;
};

/** Backspace and Delete remove a video timestamp whole, as one chip. */
const deleteVideoTimestampOnKey = (editor: NoteBlockEditor, event: KeyboardEvent) =>
  (event.key === "Backspace" || event.key === "Delete") &&
  isPlainKey(event) &&
  deleteVideoTimestampForKey(editor, event.key);

type InputRuleUndo = { transform: Transform; from: number; to: number; text: string };

/**
 * Backspace right after a Markdown shortcut ("- ", "# ", "> "...) turns the
 * block back into the typed text. BlockNote's input rules have already
 * inserted the typed space when they record the rule, but the shared undo
 * command inserts it again, leaving "-  ". Those records are the ones with an
 * empty range; Tiptap's own (bold, code...) record the typed range and undo
 * correctly, so they're left to it.
 */
const undoMarkdownShortcut = (view: EditorView) => {
  const { state } = view;
  for (const plugin of state.plugins) {
    if (!(plugin.spec as { isInputRules?: boolean }).isInputRules) continue;
    const undo = plugin.getState(state) as InputRuleUndo | null | undefined;
    if (!undo) continue;
    if (!undo.text || undo.from !== undo.to) return false;
    const { tr } = state;
    const { steps, docs } = undo.transform;
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      tr.step(steps[index]!.invert(docs[index]!));
    }
    view.dispatch(tr);
    return true;
  }
  return false;
};

/**
 * Makes Enter its own undo step: ProseMirror would group it with the typing
 * just before and after it, so one undo took back a split and both lines.
 */
const closeUndoStepAroundKey = (view: EditorView) => {
  view.dispatch(closeHistory(view.state.tr));
  queueMicrotask(() => {
    if (!view.isDestroyed) view.dispatch(closeHistory(view.state.tr));
  });
};

type KeyRule = (view: EditorView) => boolean;

/** The rules for each structural key, tried in order before BlockNote's own handling. */
const blockKeyRules: Partial<Record<string, readonly KeyRule[]>> = {
  Backspace: [
    undoMarkdownShortcut,
    columnKeyRule("Backspace"),
    backspaceCodeIntoParagraph,
    backspaceIntoBlockAbove,
  ],
  Delete: [columnKeyRule("Delete"), removeEmptyBlockOnDelete, deleteIntoBlockBelow],
  Enter: [columnKeyRule("Enter"), enterAtBlockStart, enterAtToggleEnd],
  Tab: [addTableRowOnTab, (view) => indentCodeLines(view, false)],
  "Shift-Tab": [(view) => indentCodeLines(view, true)],
};

const keyName = (event: KeyboardEvent) => (event.shiftKey ? `Shift-${event.key}` : event.key);

/**
 * The note editor's `handleKeyDown`: its key rules, in order, ahead of
 * BlockNote's keyboard shortcuts. Returns true when a rule handled the key.
 */
export const handleNoteEditorKeyDown = (
  editor: NoteBlockEditor,
  view: EditorView,
  event: KeyboardEvent,
) => {
  if (
    deleteVideoTimestampOnKey(editor, event) ||
    insertFirstKeyInEmptyTextBlock(view, event) ||
    moveCaretToNoteEnd(view, event) ||
    selectBlockTextFirst(view, event)
  ) {
    return true;
  }
  if (!isPlainKey(event)) return false;
  // An open slash, mention or emoji menu takes Enter and Tab itself.
  if (editor.getExtension(SuggestionMenu)?.shown()) return false;
  if (event.key === "Enter") closeUndoStepAroundKey(view);
  return (blockKeyRules[keyName(event)] ?? []).some((rule) => rule(view));
};

/** The note editor's `handleTextInput`: typed-text replacements ahead of BlockNote's input rules. */
export const handleNoteEditorTextInput = (
  editor: NoteBlockEditor,
  view: EditorView,
  from: number,
  to: number,
  text: string,
) => replaceTypedArrow(view, from, to, text) || typeDividerShortcut(editor, from, to, text);

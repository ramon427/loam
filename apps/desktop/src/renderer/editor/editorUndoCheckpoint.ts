import {
  closeHistory,
  history,
  redoDepth,
  redoNoScroll,
  undoDepth,
  undoNoScroll,
} from "@tiptap/pm/history";
import { EditorState, Plugin, Selection, type Command, type Transaction } from "@tiptap/pm/state";
import { Step } from "@tiptap/pm/transform";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface HistoryGroup {
  steps: Json[];
  inverseSteps: Json[];
  beforeSelection: Json;
  afterSelection: Json;
}

export interface EditorUndoCheckpoint {
  document: Json;
  selection: Json;
  undo: HistoryGroup[];
  redo: HistoryGroup[];
}

const historyKey = history().spec.key;
const MAX_EVENTS = 256;
const MAX_BYTES = 2 * 1024 * 1024;

function historyPlugin(state: EditorState) {
  return state.plugins.find((plugin) => plugin.spec.key === historyKey);
}

function runHistory(state: EditorState, command: Command): Transaction {
  let result: Transaction | undefined;
  command(state, (transaction) => {
    result = transaction;
  });
  if (!result) throw new Error("History event is unavailable");
  return result;
}

function collectGroups(state: EditorState, command: Command, count: number): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (let index = 0; index < count; index++) {
    const transaction = runHistory(state, command);
    groups.push({
      steps: transaction.steps.map((step) => step.toJSON()),
      inverseSteps: transaction.steps
        .map((step, i) => step.invert(transaction.docs[i]).toJSON())
        .reverse(),
      beforeSelection: state.selection.toJSON(),
      afterSelection: transaction.selection.toJSON(),
    });
    state = state.apply(transaction);
  }
  return groups;
}

/** Snapshot native events without applying transactions to any domain plugin. */
export function captureEditorUndoCheckpoint(state: EditorState): EditorUndoCheckpoint | null {
  const plugin = historyPlugin(state);
  if (!plugin) return null;
  const undoCount: number = undoDepth(state);
  const redoCount: number = redoDepth(state);
  if (undoCount + redoCount > MAX_EVENTS) return null;
  try {
    const isolated = state.reconfigure({ plugins: [plugin] });
    const checkpoint: EditorUndoCheckpoint = {
      document: state.doc.toJSON(),
      selection: state.selection.toJSON(),
      undo: collectGroups(isolated, undoNoScroll, undoCount),
      redo: collectGroups(isolated, redoNoScroll, redoCount),
    };
    const serialized = JSON.stringify(checkpoint);
    if (new TextEncoder().encode(serialized).byteLength > MAX_BYTES) return null;
    // Detach attributes/custom step JSON from objects owned by the live editor.
    return JSON.parse(serialized) as EditorUndoCheckpoint;
  } catch {
    return null;
  }
}

function applySteps(
  state: EditorState,
  steps: Json[],
  selection: Json,
  recorded: boolean,
): EditorState {
  const transaction = closeHistory(state.tr);
  for (const step of steps) transaction.step(Step.fromJSON(state.schema, step));
  transaction.setSelection(Selection.fromJSON(transaction.doc, selection));
  if (!recorded) transaction.setMeta("addToHistory", false);
  return state.apply(transaction);
}

function rebuildHistory(state: EditorState, checkpoint: EditorUndoCheckpoint): EditorState {
  let rebuilt = EditorState.create({
    schema: state.schema,
    doc: state.doc,
    selection: state.selection,
  });
  for (const group of checkpoint.undo)
    rebuilt = applySteps(rebuilt, group.steps, group.afterSelection, false);
  rebuilt = rebuilt.reconfigure({
    plugins: [
      history({
        depth: Math.max(MAX_EVENTS, checkpoint.undo.length + checkpoint.redo.length),
      }),
    ],
  });
  for (const group of [...checkpoint.undo].reverse()) {
    rebuilt = applySteps(rebuilt, [], group.afterSelection, false);
    rebuilt = applySteps(rebuilt, group.inverseSteps, group.beforeSelection, true);
  }
  for (const group of checkpoint.redo) {
    rebuilt = applySteps(rebuilt, [], group.beforeSelection, false);
    rebuilt = applySteps(rebuilt, group.steps, group.afterSelection, true);
  }
  for (let index = 0; index < checkpoint.redo.length; index++)
    rebuilt = rebuilt.apply(runHistory(rebuilt, undoNoScroll));
  return applySteps(rebuilt, [], checkpoint.selection, false);
}

/** Rebuild against the fresh schema, preserving every non-history target plugin state. */
export function restoreEditorUndoCheckpoint(
  state: EditorState,
  checkpoint: EditorUndoCheckpoint,
): EditorState | null {
  const plugin = historyPlugin(state);
  if (!plugin) return null;
  try {
    if (!state.doc.eq(state.schema.nodeFromJSON(checkpoint.document))) return null;
    const rebuilt = rebuildHistory(state, checkpoint);
    if (
      !rebuilt.doc.eq(state.doc) ||
      undoDepth(rebuilt) !== checkpoint.undo.length ||
      redoDepth(rebuilt) !== checkpoint.redo.length
    )
      return null;
    // Public plugin state initialization transfers the opaque history value only.
    const seed = new Plugin({
      ...plugin.spec,
      state: { ...plugin.spec.state!, init: () => historyKey!.getState(rebuilt) },
    });
    const withoutHistory = state.reconfigure({
      plugins: state.plugins.filter((entry) => entry !== plugin),
    });
    return withoutHistory
      .reconfigure({ plugins: state.plugins.map((entry) => (entry === plugin ? seed : entry)) })
      .reconfigure({ plugins: state.plugins });
  } catch {
    return null;
  }
}

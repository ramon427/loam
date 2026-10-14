import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import {
  isEditableTarget,
  matchesShortcut,
  shortcuts,
  type ShortcutCombo,
} from "../keyboard/shortcuts";

import { NOTE_GRAPH_GRID, type NoteGraphResizeDirection } from "./noteGraphGeometry";
import type { NoteGraphMode } from "./noteGraphMode";

/** What the graph's keys do. */
export type NoteGraphKeyCommands = {
  focusPane: () => void;
  closeSnapshotCapture: () => void;
  exitTouchMarquee: () => void;
  exitWalkthrough: () => void;
  stepWalkthrough: (delta: 1 | -1) => void;
  cancelConnect: () => void;
  commitConnect: () => void;
  moveConnectTarget: (delta: 1 | -1) => void;
  openSearch: () => void;
  addNodeInCenter: () => void;
  zoomTo100: () => void;
  zoomToSelection: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitView: () => void;
  startConnect: () => void;
  toggleFocusMode: () => void;
  copy: () => void;
  cut: () => void;
  duplicate: () => void;
  selectAll: () => void;
  undo: () => void;
  redo: () => void;
  deleteSelection: () => void;
  clearSelection: () => void;
  renameSelection: () => void;
  nudge: (delta: { x: number; y: number }) => void;
  resize: (direction: NoteGraphResizeDirection, step: number) => void;
};

type ModeKind = NoteGraphMode["kind"];

type KeyBinding = {
  name: string;
  combos: ShortcutCombo[];
  /** Modes the binding works in. */
  modes: readonly ModeKind[];
  run: (commands: NoteGraphKeyCommands) => void;
  /** Also works while typing in a field inside the graph. */
  allowInEditable?: boolean;
  /** The command moves focus itself (into a field); otherwise focus returns to the canvas. */
  movesFocus?: boolean;
};

const editing: readonly ModeKind[] = ["idle", "touchMarquee"];

const arrows = [
  { key: "ArrowLeft", x: -1, y: 0, direction: "left" },
  { key: "ArrowRight", x: 1, y: 0, direction: "right" },
  { key: "ArrowUp", x: 0, y: -1, direction: "up" },
  { key: "ArrowDown", x: 0, y: 1, direction: "down" },
] as const;

/**
 * Every graph key, by mode. Pasting is not here: Ctrl/Cmd+V has to reach the browser so it
 * fires the paste event, which carries images from the system clipboard.
 */
const noteGraphKeymap: KeyBinding[] = [
  {
    name: "close-snapshot-capture",
    combos: [{ key: "Escape" }],
    modes: ["captureSnapshot"],
    run: (commands) => commands.closeSnapshotCapture(),
  },
  {
    name: "exit-touch-selection",
    combos: [{ key: "Escape" }],
    modes: ["touchMarquee"],
    run: (commands) => commands.exitTouchMarquee(),
  },
  {
    name: "exit-walkthrough",
    combos: [{ key: "Escape" }],
    modes: ["walkthrough"],
    run: (commands) => commands.exitWalkthrough(),
  },
  {
    name: "walkthrough-next",
    combos: [{ key: "ArrowRight" }, { key: "ArrowDown" }],
    modes: ["walkthrough"],
    run: (commands) => commands.stepWalkthrough(1),
  },
  {
    name: "walkthrough-previous",
    combos: [{ key: "ArrowLeft" }, { key: "ArrowUp" }],
    modes: ["walkthrough"],
    run: (commands) => commands.stepWalkthrough(-1),
  },
  {
    name: "cancel-connect",
    combos: [{ key: "Escape" }],
    modes: ["connect"],
    run: (commands) => commands.cancelConnect(),
  },
  {
    name: "connect",
    combos: [{ key: "Enter" }],
    modes: ["connect"],
    run: (commands) => commands.commitConnect(),
  },
  {
    name: "next-connect-target",
    combos: [{ key: "ArrowRight" }, { key: "ArrowDown" }],
    modes: ["connect"],
    run: (commands) => commands.moveConnectTarget(1),
  },
  {
    name: "previous-connect-target",
    combos: [{ key: "ArrowLeft" }, { key: "ArrowUp" }],
    modes: ["connect"],
    run: (commands) => commands.moveConnectTarget(-1),
  },
  {
    name: "find",
    combos: [{ key: "f", mod: true }],
    modes: editing,
    run: (commands) => commands.openSearch(),
    allowInEditable: true,
    movesFocus: true,
  },
  {
    name: "add-node",
    combos: [{ key: "Enter", mod: true }],
    modes: editing,
    run: (commands) => commands.addNodeInCenter(),
    movesFocus: true,
  },
  {
    name: "zoom-100",
    combos: [{ key: "1", mod: true }],
    modes: editing,
    run: (commands) => commands.zoomTo100(),
  },
  {
    name: "zoom-selection",
    combos: [{ key: "2", mod: true }],
    modes: editing,
    run: (commands) => commands.zoomToSelection(),
  },
  {
    name: "zoom-in",
    combos: [
      { key: "=", mod: true },
      { key: "+", mod: true },
      { key: "+", mod: true, shiftKey: true },
    ],
    modes: editing,
    run: (commands) => commands.zoomIn(),
  },
  {
    name: "zoom-out",
    combos: [{ key: "-", mod: true }],
    modes: editing,
    run: (commands) => commands.zoomOut(),
  },
  {
    name: "fit-view",
    combos: [shortcuts["graph.fit-view"]],
    modes: editing,
    run: (commands) => commands.fitView(),
  },
  {
    name: "start-connect",
    combos: [shortcuts["graph.connect"]],
    modes: editing,
    run: (commands) => commands.startConnect(),
  },
  {
    name: "focus-mode",
    combos: [{ key: "f" }],
    modes: editing,
    run: (commands) => commands.toggleFocusMode(),
  },
  {
    name: "copy",
    combos: [shortcuts["edit.copy"]],
    modes: editing,
    run: (commands) => commands.copy(),
  },
  {
    name: "cut",
    combos: [shortcuts["edit.cut"]],
    modes: editing,
    run: (commands) => commands.cut(),
  },
  {
    name: "duplicate",
    combos: [shortcuts["graph.duplicate"]],
    modes: editing,
    run: (commands) => commands.duplicate(),
  },
  {
    name: "select-all",
    combos: [shortcuts["edit.select-all"]],
    modes: editing,
    run: (commands) => commands.selectAll(),
  },
  {
    name: "undo",
    combos: [shortcuts["edit.undo"]],
    modes: editing,
    run: (commands) => commands.undo(),
  },
  {
    name: "redo",
    combos: [shortcuts["edit.redo"]],
    modes: editing,
    run: (commands) => commands.redo(),
  },
  {
    name: "delete",
    combos: [shortcuts["graph.delete"], { key: "Backspace" }],
    modes: editing,
    run: (commands) => commands.deleteSelection(),
  },
  {
    name: "clear-selection",
    combos: [{ key: "Escape" }],
    modes: ["idle"],
    run: (commands) => commands.clearSelection(),
  },
  {
    name: "rename",
    combos: [{ key: "Enter" }],
    modes: editing,
    run: (commands) => commands.renameSelection(),
    movesFocus: true,
  },
  ...arrows.flatMap(({ key, x, y, direction }): KeyBinding[] => [
    {
      name: `nudge-${direction}`,
      combos: [{ key }],
      modes: editing,
      run: (commands) => commands.nudge({ x, y }),
    },
    {
      name: `nudge-${direction}-far`,
      combos: [{ key, shiftKey: true }],
      modes: editing,
      run: (commands) => commands.nudge({ x: x * 10, y: y * 10 }),
    },
    {
      name: `resize-${direction}`,
      combos: [{ key, mod: true }],
      modes: editing,
      run: (commands) => commands.resize(direction, NOTE_GRAPH_GRID),
    },
    {
      name: `resize-${direction}-far`,
      combos: [{ key, mod: true, shiftKey: true }],
      modes: editing,
      run: (commands) => commands.resize(direction, NOTE_GRAPH_GRID * 4),
    },
  ]),
];

/**
 * Runs the graph's key for a keydown on the canvas. A key the focused control or an open
 * menu already handled (`defaultPrevented`) is left alone, as is one pressed outside the
 * canvas's own elements (in a menu or dialog it opened, which React still bubbles here).
 * Handled keys are default-prevented, so the app's shortcuts skip them.
 */
export function handleNoteGraphKeyDown(
  event: ReactKeyboardEvent<HTMLElement>,
  mode: ModeKind,
  commands: NoteGraphKeyCommands,
) {
  if (event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return;
  const editable = isEditableTarget(event.target);
  const binding = noteGraphKeymap.find(
    (candidate) =>
      candidate.modes.includes(mode) &&
      (!editable || candidate.allowInEditable) &&
      candidate.combos.some((combo) => matchesShortcut(event.nativeEvent, combo)),
  );
  if (binding) {
    event.preventDefault();
    binding.run(commands);
    if (!binding.movesFocus) commands.focusPane();
    return;
  }
  // React Flow pans while Space is held; this only keeps Space from scrolling the page.
  if (!editable && matchesShortcut(event.nativeEvent, { key: " " })) event.preventDefault();
}

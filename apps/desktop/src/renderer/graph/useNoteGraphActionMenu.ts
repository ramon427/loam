import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";

import { isActionMenuTarget, leaveToNativeMenu } from "../action-menu/ActionMenu";
import { noteGraphNodeColors } from "@loam/shared/notes/noteGraphColors";
import { getNoteGraphNodeSize } from "@loam/shared/notes/noteGraphGeometry";

import type { NoteGraphMenuContext } from "./NoteGraphMenu";
import { snapNoteGraphNodeSizeToGrid } from "./noteGraphGeometry";
import type { NoteGraphAlignMode, NoteGraphDistributeAxis } from "./noteGraphLayout";
import * as ops from "./noteGraphOps";
import {
  noteGraphAlignOptions,
  noteGraphDistributeOptions,
  noteGraphReorderOptions,
  noteGraphShapeOptions,
} from "./noteGraphShapes";

type Point = { x: number; y: number };

/** What the canvas menu can do, beyond the pure graph operations it runs itself. */
type NoteGraphActionMenuCommands = {
  readOnly: boolean;
  getState: () => ops.NoteGraphState;
  run: (operation: (state: ops.NoteGraphState) => ops.NoteGraphEdit | null) => unknown;
  select: (selection: ops.NoteGraphSelection) => void;
  screenToFlowPosition: (point: Point) => Point | null;
  canPaste: () => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
  undo: () => void;
  redo: () => void;
  copy: () => boolean;
  paste: (at: Point | null) => void;
  fitView: () => void;
  focusPane: () => void;
  beginTitleEdit: (nodeId: string) => void;
  /** Opens the details of a node, or of what is selected. */
  openDetails: (nodeId?: string) => void;
  startConnect: () => void;
  editEdgeLabel: (edgeId: string) => void;
  requestImageUpload: (nodeId: string) => void;
  align: (mode: NoteGraphAlignMode) => void;
  distribute: (axis: NoteGraphDistributeAxis) => void;
  announce: (message: string) => void;
};

/** The option a submenu item names, or undefined when it names none. */
const pick = <T extends string>(options: ReadonlyArray<{ id: T }>, value: string | undefined) =>
  options.find((option) => option.id === value)?.id;

function runMenuAction(
  commands: NoteGraphActionMenuCommands,
  action: string,
  value: string | undefined,
  target: { nodeId?: string; edgeId: string | null; point?: Point; eventTarget: Element },
) {
  const { run } = commands;
  const { nodeId, edgeId } = target;
  const actions: Record<string, () => unknown> = {
    "fit-view": commands.fitView,
    undo: commands.undo,
    redo: commands.redo,
    "select-all": () => run(ops.selectAll),
    paste: () => commands.paste(target.point ?? null),
    "add-node": () => {
      const shape = pick(noteGraphShapeOptions, value);
      if (shape && target.point) {
        run((state) => ops.addNode(state, { shape, position: target.point! }));
      }
    },
    "edit-title": () => nodeId && commands.beginTitleEdit(nodeId),
    properties: () => commands.openDetails(nodeId),
    connect: commands.startConnect,
    copy: commands.copy,
    cut: () => commands.copy() && run(ops.deleteSelection),
    duplicate: () => run(ops.duplicateSelection),
    delete: () => run(ops.deleteSelection),
    lock: () => run(ops.toggleLockSelection),
    "edit-label": () => edgeId && commands.editEdgeLabel(edgeId),
    "reverse-edge": () => edgeId && run((state) => ops.reverseEdge(state, edgeId)),
    "replace-image": () => nodeId && commands.requestImageUpload(nodeId),
    "fit-image": () => {
      const image = target.eventTarget.closest(".react-flow__node")?.querySelector("img");
      const node = commands.getState().graph.nodes.find((item) => item.id === nodeId);
      if (!node || !image?.naturalWidth || !image.naturalHeight) {
        commands.announce("Wait for the image to load before fitting it");
        return;
      }
      const { width } = getNoteGraphNodeSize(node);
      const size = snapNoteGraphNodeSizeToGrid({
        width,
        height: (width * image.naturalHeight) / image.naturalWidth,
      });
      run((state) => ops.updateNode(state, node.id, { size }));
    },
    color: () => {
      const color = noteGraphNodeColors.find((item) => item === value);
      if (color) run((state) => ops.updateSelectedNodes(state, { color, colorHex: undefined }));
    },
    shape: () => {
      const shape = pick(noteGraphShapeOptions, value);
      if (shape) run((state) => ops.updateSelectedNodes(state, { shape }));
    },
    order: () => {
      const order = pick(noteGraphReorderOptions, value);
      if (order) run((state) => ops.reorderSelection(state, order));
    },
    align: () => {
      const mode = pick(noteGraphAlignOptions, value);
      if (mode) commands.align(mode);
    },
    distribute: () => {
      const axis = pick(noteGraphDistributeOptions, value);
      if (axis) commands.distribute(axis);
    },
    "frame-selection": () => run(ops.frameSelection),
    "select-contents": () => nodeId && run((state) => ops.selectFrameContents(state, nodeId)),
    "collapse-frame": () => nodeId && run((state) => ops.toggleFrameCollapsed(state, nodeId)),
    "fit-frame": () => nodeId && run((state) => ops.fitFrameToContents(state, nodeId)),
    "remove-frame": () => nodeId && run((state) => ops.removeFrame(state, nodeId)),
  };
  actions[action]?.();
}

type MenuTarget = { nodeId?: string; edgeId: string | null; point?: Point; eventTarget: Element };

/**
 * The canvas context menu. Right-clicking a node or connector selects it first (keeping a
 * multi-selection the node belongs to), so every item acts on what the user sees selected.
 * Spread `triggerProps` on the menu's trigger and render `context` with `NoteGraphMenu`,
 * running items through `run`.
 */
export function useNoteGraphActionMenu(commands: NoteGraphActionMenuCommands) {
  const latest = useRef(commands);
  useLayoutEffect(() => {
    latest.current = commands;
  });
  const [menu, setMenu] = useState<{ context: NoteGraphMenuContext; target: MenuTarget } | null>(
    null,
  );

  const onContextMenuCapture = (event: MouseEvent) => {
    if (!isActionMenuTarget(event)) {
      leaveToNativeMenu(event);
      return;
    }
    const eventTarget = event.target as Element;
    const current = latest.current;
    const nodeId = eventTarget.closest(".react-flow__node")?.getAttribute("data-id") ?? undefined;
    const edgeId = eventTarget.closest(".react-flow__edge")?.getAttribute("data-id") ?? null;
    const { graph, selection } = current.getState();
    const node = graph.nodes.find((item) => item.id === nodeId);
    const edge = graph.edges.find((item) => item.id === edgeId);
    let nodeIds: string[] = [];
    if (node) {
      nodeIds = selection.nodeIds.includes(node.id)
        ? [node.id, ...selection.nodeIds.filter((id) => id !== node.id)]
        : [node.id];
    }
    if (node || edge) current.select({ nodeIds, edgeId: node ? null : (edge?.id ?? null) });
    const selected = ops.selectedNodes(current.getState());
    setMenu({
      context: {
        kind: node ? "node" : edge ? "edge" : "pane",
        node,
        edge,
        selectionCount: selected.length,
        readOnly: current.readOnly,
        canPaste: current.canPaste(),
        canUndo: current.canUndo(),
        canRedo: current.canRedo(),
        allLocked: edge ? Boolean(edge.locked) : selected.every((item) => item.locked),
      },
      target: {
        nodeId,
        edgeId,
        point: current.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? undefined,
        eventTarget,
      },
    });
  };

  const run = (action: string, value?: string) => {
    const current = latest.current;
    if (!menu) return;
    if (current.readOnly && !["copy", "properties", "fit-view"].includes(action)) return;
    current.focusPane();
    runMenuAction(current, action, value, menu.target);
  };

  return { triggerProps: { onContextMenuCapture }, context: menu?.context ?? null, run };
}

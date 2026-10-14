import { Fragment, type ReactNode } from "react";

import { noteGraphNodeColors } from "@loam/shared/notes/noteGraphColors";
import { ActionMenuItem, ActionMenuSub } from "../action-menu/ActionMenu";
import type { ShortcutId } from "../keyboard/shortcuts";
import { ContextMenuSeparator } from "../ui/ContextMenu";
import type { NoteGraphEdge, NoteGraphNode } from "@loam/shared/notes/noteModel";
import {
  noteGraphAlignOptions,
  noteGraphDistributeOptions,
  noteGraphReorderOptions,
  noteGraphShapeOptions,
} from "./noteGraphShapes";

export type NoteGraphMenuContext = {
  kind: "node" | "edge" | "pane";
  node?: NoteGraphNode;
  edge?: NoteGraphEdge;
  selectionCount: number;
  readOnly: boolean;
  canPaste: boolean;
  canUndo: boolean;
  canRedo: boolean;
  allLocked: boolean;
};

/** Runs a menu action by name, with the option picked in a submenu (a color, a shape…). */
export type NoteGraphMenuRun = (action: string, value?: string) => void;

const shortcuts: Partial<Record<string, ShortcutId>> = {
  copy: "edit.copy",
  cut: "edit.cut",
  duplicate: "graph.duplicate",
  delete: "graph.delete",
  connect: "graph.connect",
  paste: "edit.paste",
  "select-all": "edit.select-all",
  undo: "edit.undo",
  redo: "edit.redo",
  "fit-view": "graph.fit-view",
};

/** The canvas's right-click menu for a node, a connector, a multi-selection or empty canvas. */
export function NoteGraphMenu({
  context,
  run,
}: {
  context: NoteGraphMenuContext;
  run: NoteGraphMenuRun;
}) {
  const { readOnly, allLocked, node, kind, selectionCount } = context;
  const blocked = readOnly || allLocked;
  const item = (action: string, label: string, disabled = false, value?: string) => (
    <ActionMenuItem
      key={`${action}-${value ?? ""}`}
      disabled={disabled}
      destructive={action === "delete" || action === "remove-frame"}
      shortcut={shortcuts[action]}
      onSelect={() => run(action, value)}
    >
      {label}
    </ActionMenuItem>
  );
  const submenu = (key: string, label: string, items: ReactNode, disabled = blocked) => (
    <ActionMenuSub key={key} label={label} disabled={disabled}>
      {items}
    </ActionMenuSub>
  );
  const sections = (...groups: ReactNode[][]) =>
    groups.map((group, index) => (
      <Fragment key={index}>
        {index > 0 ? <ContextMenuSeparator /> : null}
        {group}
      </Fragment>
    ));

  const color = submenu(
    "color",
    "Color",
    noteGraphNodeColors.map((value) =>
      item("color", value[0]!.toUpperCase() + value.slice(1), blocked, value),
    ),
  );
  const order = submenu(
    "arrange",
    "Arrange",
    noteGraphReorderOptions.map((option) => item("order", option.label, blocked, option.id)),
  );
  const lock = item("lock", allLocked ? "Unlock" : "Lock", readOnly);

  if (kind === "pane") {
    return sections(
      [
        submenu(
          "add",
          "Add node here",
          noteGraphShapeOptions.map((shape) => item("add-node", shape.label, readOnly, shape.id)),
          readOnly,
        ),
        item("paste", "Paste here", readOnly || !context.canPaste),
      ],
      [
        item("undo", "Undo", readOnly || !context.canUndo),
        item("redo", "Redo", readOnly || !context.canRedo),
      ],
      [item("select-all", "Select all", readOnly), item("fit-view", "Fit graph")],
    );
  }
  if (kind === "edge") {
    return sections(
      [
        item("edit-label", "Edit label", blocked),
        item("properties", "Properties"),
        item("reverse-edge", "Reverse direction", blocked),
      ],
      [lock, item("delete", "Delete connector", blocked)],
    );
  }
  const clipboard = [
    item("duplicate", "Duplicate", blocked),
    item("copy", "Copy"),
    item("cut", "Cut", blocked),
  ];
  if (selectionCount > 1) {
    return sections(
      clipboard,
      [
        submenu("alignment", "Align / distribute", [
          ...noteGraphAlignOptions.map((option) => item("align", option.label, blocked, option.id)),
          ...noteGraphDistributeOptions.map((option) =>
            item("distribute", option.label, blocked || selectionCount < 3, option.id),
          ),
        ]),
        item("frame-selection", "Put in frame", blocked),
        color,
        order,
      ],
      [lock, item("delete", `Delete ${selectionCount} selected nodes`, blocked)],
    );
  }
  const shape =
    node?.shape === "frame" || node?.shape === "image"
      ? []
      : [
          submenu(
            "shape",
            "Shape",
            noteGraphShapeOptions
              .filter((option) => option.id !== "frame")
              .map((option) => item("shape", option.label, blocked, option.id)),
          ),
        ];
  return sections(
    [
      item("edit-title", node?.shape === "frame" ? "Rename frame" : "Edit title", blocked),
      item("properties", "Properties"),
      item("connect", "Connect to…", blocked),
    ],
    clipboard,
    ...(node?.shape === "frame"
      ? [
          [
            item("collapse-frame", node.collapsed ? "Expand frame" : "Collapse frame", blocked),
            item("select-contents", "Select contents", readOnly),
            item("fit-frame", "Fit around contents", blocked),
          ],
        ]
      : []),
    ...(node?.shape === "image"
      ? [
          [
            item("replace-image", "Replace image", blocked),
            item("fit-image", "Fit to image", blocked),
          ],
        ]
      : []),
    [color, ...shape, order],
    [
      lock,
      node?.shape === "frame"
        ? item("remove-frame", "Remove frame, keep contents", blocked)
        : item("delete", "Delete node and its connectors", blocked),
    ],
  );
}

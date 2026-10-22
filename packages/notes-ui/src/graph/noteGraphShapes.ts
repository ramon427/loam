import {
  CircleIcon,
  DiamondIcon,
  FrameIcon,
  RectangleHorizontalIcon,
  StickyNoteIcon,
  TypeIcon,
  type LucideIcon,
} from "lucide-react";
import type { NoteGraphNodeShape } from "@loam/shared/notes/noteModel";

import type { NoteGraphAlignMode, NoteGraphDistributeAxis } from "./noteGraphLayout";
import type { NoteGraphReorder } from "./noteGraphOps";

/** The shapes the toolbar, menus and filters offer, in that order. */
export const noteGraphShapeOptions: Array<{
  id: NoteGraphNodeShape;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "process", label: "Process", icon: RectangleHorizontalIcon },
  { id: "terminator", label: "Start / end", icon: RectangleHorizontalIcon },
  { id: "decision", label: "Decision", icon: DiamondIcon },
  { id: "ellipse", label: "Ellipse", icon: CircleIcon },
  { id: "sticky", label: "Sticky note", icon: StickyNoteIcon },
  { id: "text", label: "Text", icon: TypeIcon },
  { id: "frame", label: "Frame", icon: FrameIcon },
];

/** How the toolbar's selection bar and the right-click menu offer to align a selection. */
export const noteGraphAlignOptions: ReadonlyArray<{ id: NoteGraphAlignMode; label: string }> = [
  { id: "left", label: "Left" },
  { id: "center-x", label: "Center horizontally" },
  { id: "right", label: "Right" },
  { id: "top", label: "Top" },
  { id: "center-y", label: "Center vertically" },
  { id: "bottom", label: "Bottom" },
];

export const noteGraphDistributeOptions: ReadonlyArray<{
  id: NoteGraphDistributeAxis;
  label: string;
}> = [
  { id: "horizontal", label: "Distribute horizontally" },
  { id: "vertical", label: "Distribute vertically" },
];

/** Drawing-order changes, with what the status line says once one is made. */
export const noteGraphReorderOptions: ReadonlyArray<{
  id: NoteGraphReorder;
  label: string;
  done: string;
}> = [
  { id: "forward", label: "Bring forward", done: "Brought forward" },
  { id: "backward", label: "Send backward", done: "Sent backward" },
  { id: "front", label: "Bring to front", done: "Brought to front" },
  { id: "back", label: "Send to back", done: "Sent to back" },
];

import { createContext } from "react";
import type { NoteGraphNode } from "@loam/shared/notes/noteModel";

/** What a node card can do; the canvas provides it to every card through context. */
export type NoteGraphNodeActions = {
  readOnly: boolean;
  /** Node details hide when the canvas is zoomed far out. */
  detailsVisible: boolean;
  updateNode: (nodeId: string, patch: Partial<NoteGraphNode>) => void;
  /** Settles a resize; `x`/`y` move the node when a top or left handle was dragged. */
  resizeNode: (
    nodeId: string,
    rect: { width: number; height: number; x?: number; y?: number },
  ) => void;
  /** Saves `patch` on the node and adds a connected child or sibling. */
  chainFromNode: (
    nodeId: string,
    kind: "child" | "sibling",
    patch?: Partial<NoteGraphNode>,
  ) => void;
  toggleFrameCollapsed: (nodeId: string) => void;
  /** Removes a text object its writer left without text. */
  removeEmptyText: (nodeId: string) => void;
  frameMemberCount: (frameId: string) => number;
  openHeadingConnections: (nodeId: string) => void;
  requestImageUpload: (nodeId: string) => void;
  seekVideoTimestamp?: (seconds: number) => void;
  focusGraphPane: () => void;
  /** The node whose title or text is being edited on the canvas, if any. */
  titleEdit: { nodeId: string; requestId: number } | null;
  beginTitleEdit: (nodeId: string) => void;
  endTitleEdit: (nodeId: string) => void;
  /** Selects the node and opens its details: notes, headings and more. */
  openDetails: (nodeId: string) => void;
};

export const NoteGraphNodeActionsContext = createContext<NoteGraphNodeActions | null>(null);

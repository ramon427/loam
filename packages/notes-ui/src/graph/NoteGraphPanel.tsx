import { ReactFlowProvider } from "@xyflow/react";
import { PlusIcon, ShapesIcon } from "lucide-react";
import type { MutableRefObject } from "react";

import type { NoteHeadingConnectionOption } from "../editor/noteHeadingConnections";
import type { TabHistoryCommands } from "../note/useTypedTabHistory";
import { Button } from "../ui/Button";
import type { NoteGraphSnapshot, NoteGraph } from "@loam/shared/notes/noteModel";

import { NoteGraphCanvas } from "./NoteGraphCanvas";
import type { NoteDocument } from "../workspace/types";

export type NoteGraphPanelProps = {
  tabId: string;
  note: NoteDocument;
  graph?: NoteGraph;
  /** The primary selection, shared with the note (for example to link a heading). */
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  readOnly: boolean;
  onAddGraph: () => void;
  onUpdateGraph: (graph: NoteGraph | null) => void;
  onSelectNode: (nodeId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
  headingOptions: readonly NoteHeadingConnectionOption[];
  onToggleHeadingConnection: (nodeId: string, headingBlockId: string) => void;
  onOpenHeading: (headingBlockId: string) => void;
  revealNodeRequest?: { nodeId: string; requestId: number } | null;
  historyBridgeRef?: MutableRefObject<TabHistoryCommands | null>;
  /** Learning workspace: seek the attached video (enables timestamp chips). */
  onSeekVideoTimestamp?: (seconds: number) => void;
  /** Learning workspace: current playback seconds for "node at video time". */
  getVideoSeconds?: () => number | null;
  onInsertSnapshot?: (snapshot: NoteGraphSnapshot, pageTabId?: string) => boolean | void;
};

/** A note's graph tab: the canvas, or an invitation to start one. */
export function NoteGraphPanel(props: NoteGraphPanelProps) {
  const { graph } = props;
  if (!graph?.enabled) {
    return (
      <div className="flex min-h-[34rem] flex-1 flex-col items-center justify-center gap-3 bg-(--app-page-2) p-6 text-center">
        <div className="rounded-full border border-(--app-border)/70 bg-(--app-page) p-3">
          <ShapesIcon className="size-5 text-(--app-muted)" />
        </div>
        <div>
          <p className="text-sm font-medium text-(--app-text)">Start a diagram</p>
          <p className="mt-1 max-w-sm text-xs text-(--app-muted)">
            Add shapes, connect ideas, and link nodes to headings in page tabs.
          </p>
        </div>
        <Button disabled={props.readOnly} onClick={props.onAddGraph} size="sm">
          <PlusIcon className="size-4" /> Add graph
        </Button>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <NoteGraphCanvas {...props} graph={graph} />
    </ReactFlowProvider>
  );
}

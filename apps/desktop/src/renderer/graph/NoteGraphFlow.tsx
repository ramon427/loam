import "@xyflow/react/dist/style.css";

import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  MiniMap,
  ReactFlow,
  useViewport,
  type ReactFlowProps,
} from "@xyflow/react";
import type { CSSProperties } from "react";

import { CanvasDotBackground } from "../ui/CanvasDotBackground";
import { resolveNoteGraphNodeHex } from "@loam/shared/notes/noteGraphColors";

import { NoteGraphConnectionLine, NoteGraphNewNodePreviewContext } from "./NoteGraphConnectionLine";
import { defaultViewport } from "./noteGraphFitView";
import {
  connectionLineStyle,
  edgeDefaults,
  noteGraphPanMouseButtons,
  resolveNoteGraphPointerInteraction,
  type GraphFlowEdge,
  type GraphFlowNode,
} from "./noteGraphFlowElements";
import { NOTE_GRAPH_GRID, noteGraphGridGap } from "./noteGraphGeometry";
import type { NoteGraphViewPreferences } from "./noteGraph";
import { noteGraphNodeTypes } from "./NoteGraphNodeCard";
import type { NoteGraph } from "@loam/shared/notes/noteModel";

const flowTheme = {
  "--xy-minimap-background-color": "var(--card-bg)",
  "--xy-minimap-mask-background-color": "color-mix(in srgb, var(--app-page) 72%, transparent)",
  "--xy-minimap-node-background-color": "var(--app-muted)",
  "--xy-selection-background-color": "color-mix(in srgb, var(--app-accent) 16%, transparent)",
  "--xy-selection-border": "1px solid color-mix(in srgb, var(--app-accent) 72%, transparent)",
} as CSSProperties;

const flowClassName =
  "note-graph-flow min-h-0 w-full flex-1 [&_.react-flow__minimap]:overflow-hidden [&_.react-flow__minimap]:rounded-md [&_.react-flow__minimap]:border [&_.react-flow__minimap]:border-(--app-border) [&_.react-flow__minimap]:shadow-sm [&_.react-flow__handle.connectionindicator]:!cursor-pointer [&_.react-flow__handle.connectingfrom]:!cursor-pointer [&_.react-flow__pane.connection]:!cursor-pointer [&_.react-flow__resize-control.handle]:!cursor-nwse-resize [&_.react-flow__resize-control.handle.top.right]:!cursor-nesw-resize [&_.react-flow__resize-control.handle.bottom.left]:!cursor-nesw-resize";

function NoteGraphDotGrid({ gap }: { gap: number }) {
  const viewport = useViewport();
  return <CanvasDotBackground {...viewport} gap={gap} style={{ zIndex: -1 }} />;
}

/** React Flow, configured for note graphs. All graph state arrives through props. */
export function NoteGraphFlow({
  nodes,
  edges,
  initialViewport,
  readOnly,
  preferences,
  spaceHeld,
  touchMarquee,
  showMinimap,
  reconnecting,
  flowProps,
  onInit,
  onMinimapClick,
}: {
  nodes: GraphFlowNode[];
  edges: GraphFlowEdge[];
  initialViewport: NoteGraph["viewport"];
  readOnly: boolean;
  preferences: Pick<NoteGraphViewPreferences, "grid" | "snap" | "scrollMode">;
  /** Space pans; snapping waits while it is held. */
  spaceHeld: boolean;
  touchMarquee: boolean;
  showMinimap: boolean;
  /** A connector end is being dragged to another node: no new-node preview. */
  reconnecting: boolean;
  flowProps: Partial<ReactFlowProps<GraphFlowNode, GraphFlowEdge>>;
  onInit: NonNullable<ReactFlowProps<GraphFlowNode, GraphFlowEdge>["onInit"]>;
  onMinimapClick: (event: React.MouseEvent, position: { x: number; y: number }) => void;
}) {
  const pointer = resolveNoteGraphPointerInteraction({ readOnly });
  const { grid, snap, scrollMode } = preferences;
  const gridGap = noteGraphGridGap(snap);
  return (
    <NoteGraphNewNodePreviewContext value={!reconnecting}>
      <ReactFlow<GraphFlowNode, GraphFlowEdge>
        className={flowClassName}
        connectionLineComponent={NoteGraphConnectionLine}
        connectionLineStyle={connectionLineStyle}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={36}
        defaultEdgeOptions={edgeDefaults}
        defaultViewport={initialViewport ?? defaultViewport}
        deleteKeyCode={null}
        edges={edges}
        edgesFocusable
        edgesReconnectable={!readOnly}
        elementsSelectable
        elevateEdgesOnSelect
        minZoom={0.15}
        multiSelectionKeyCode={pointer.multiSelectionKeyCode}
        nodeTypes={noteGraphNodeTypes}
        nodes={nodes}
        nodesConnectable={!readOnly}
        nodesDraggable={!readOnly}
        nodesFocusable
        onlyRenderVisibleElements
        panActivationKeyCode={pointer.panActivationKeyCode}
        panOnDrag={touchMarquee ? noteGraphPanMouseButtons : pointer.panOnDrag}
        panOnScroll={scrollMode === "pan"}
        preventScrolling
        proOptions={{ hideAttribution: true }}
        selectionKeyCode={pointer.selectionKeyCode}
        selectionMode={pointer.selectionMode}
        selectionOnDrag={pointer.selectionOnDrag || touchMarquee}
        snapGrid={[NOTE_GRAPH_GRID, NOTE_GRAPH_GRID]}
        snapToGrid={snap && !spaceHeld}
        style={flowTheme}
        zoomOnDoubleClick={false}
        zoomOnPinch
        zoomOnScroll={scrollMode === "zoom"}
        {...flowProps}
        onInit={onInit}
      >
        {grid === "dots" ? <NoteGraphDotGrid gap={gridGap} /> : null}
        {grid === "lines" ? (
          <Background
            color="var(--note-graph-grid-color, var(--app-border))"
            gap={gridGap}
            size={1}
            variant={BackgroundVariant.Lines}
          />
        ) : null}
        {showMinimap ? (
          <MiniMap<GraphFlowNode>
            ariaLabel="Note graph minimap"
            nodeColor={(node) => resolveNoteGraphNodeHex(node.data.node)}
            onClick={onMinimapClick}
            pannable
            position="bottom-right"
            zoomable
          />
        ) : null}
      </ReactFlow>
    </NoteGraphNewNodePreviewContext>
  );
}

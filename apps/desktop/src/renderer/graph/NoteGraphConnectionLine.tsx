import { getSmoothStepPath, useNodes, type ConnectionLineComponentProps } from "@xyflow/react";
import { createContext, use } from "react";
import { noteGraphNodeDefaultSize } from "@loam/shared/notes/noteGraphGeometry";
import { MAX_NOTE_GRAPH_NODES } from "@loam/shared/notes/noteGraphSchema";
import type { GraphFlowNode } from "./noteGraphFlowElements";

export const NoteGraphNewNodePreviewContext = createContext(true);

/** Both the connector and its drop preview use the canvas's transformed SVG. */
export function NoteGraphConnectionLine(props: ConnectionLineComponentProps<GraphFlowNode>) {
  const nodes = useNodes<GraphFlowNode>();
  const canCreateNode = use(NoteGraphNewNodePreviewContext);
  const [path] = getSmoothStepPath({
    sourceX: props.fromX,
    sourceY: props.fromY,
    sourcePosition: props.fromPosition,
    targetX: props.toX,
    targetY: props.toY,
    targetPosition: props.toPosition,
  });
  const overNode =
    props.toNode ||
    nodes.some((node) => {
      if (node.hidden) return false;
      const size = node.measured ?? node.data.node.size ?? noteGraphNodeDefaultSize;
      return (
        props.toX >= node.position.x &&
        props.toX <= node.position.x + (size.width ?? noteGraphNodeDefaultSize.width) &&
        props.toY >= node.position.y &&
        props.toY <= node.position.y + (size.height ?? noteGraphNodeDefaultSize.height)
      );
    });
  return (
    <g pointerEvents="none">
      <path
        className="react-flow__connection-path"
        d={path}
        fill="none"
        style={props.connectionLineStyle}
      />
      {canCreateNode && !overNode && nodes.length < MAX_NOTE_GRAPH_NODES ? (
        <rect
          data-note-graph-connection-preview=""
          x={props.toX - noteGraphNodeDefaultSize.width / 2}
          y={props.toY - noteGraphNodeDefaultSize.height / 2}
          width={noteGraphNodeDefaultSize.width}
          height={noteGraphNodeDefaultSize.height}
          rx={6}
          fill="var(--app-accent)"
          fillOpacity={0.05}
          stroke="var(--app-accent)"
          strokeOpacity={0.6}
          strokeWidth={2}
          strokeDasharray="6 4"
        />
      ) : null}
    </g>
  );
}

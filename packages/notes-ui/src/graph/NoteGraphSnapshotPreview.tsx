import { memo, useId, useMemo } from "react";
import type { NoteGraphSnapshot, NoteGraph, NoteGraphNode } from "@loam/shared/notes/noteModel";
import { useImageUrl } from "../media/useImageUrl";
import { getNoteGraphNodeSize } from "@loam/shared/notes/noteGraphGeometry";
import { resolveNoteGraphNodeHex } from "@loam/shared/notes/noteGraphColors";
import { formatVideoTimestamp } from "@loam/shared/notes/noteVideo";
import { resolveNoteGraphViewPreferences } from "./noteGraph";
import { noteGraphGridGap } from "./noteGraphGeometry";
import {
  noteGraphEdgeLabelBox,
  resolveNoteGraphEdgePaint,
  resolveNoteGraphNodeOutline,
  resolveNoteGraphNodeVariantPaint,
} from "./noteGraphPaint";
import { createNoteGraphSnapshotScene } from "./noteGraphSnapshotScene";
import styles from "./noteGraphSnapshot.module.css";

function SnapshotImage({ path, title }: { path: string; title: string }) {
  const { url } = useImageUrl(path, { preferred: "preview" });
  return url ? <img src={url} alt={title} className={styles.image} draggable={false} /> : null;
}

const SnapshotNode = memo(function SnapshotNode({ node }: { node: NoteGraphNode }) {
  const { width, height } = getNoteGraphNodeSize(node);
  const { x, y } = node.position;
  const shape = node.shape ?? "process";
  const color = resolveNoteGraphNodeHex(node);
  const isFrame = shape === "frame";
  const isText = shape === "text";
  const isImage = shape === "image";
  const variant = resolveNoteGraphNodeVariantPaint(node);
  const paint = {
    fill: isFrame
      ? `color-mix(in srgb, ${color} 6%, transparent)`
      : variant.tinted
        ? `color-mix(in srgb, ${color} 12%, var(--app-page))`
        : "var(--app-page)",
    stroke: color,
    strokeWidth: 2,
    strokeDasharray: variant.dash,
  };
  const outline = resolveNoteGraphNodeOutline(node);
  return (
    <g data-snapshot-node={node.id}>
      {outline?.kind === "diamond" ? <polygon points={outline.points} {...paint} /> : null}
      {outline?.kind === "ellipse" ? (
        <ellipse cx={outline.cx} cy={outline.cy} rx={outline.rx} ry={outline.ry} {...paint} />
      ) : null}
      {outline?.kind === "rect" ? (
        <rect
          x={outline.x}
          y={outline.y}
          width={outline.width}
          height={outline.height}
          rx={outline.rx}
          {...paint}
        />
      ) : null}
      <foreignObject x={x} y={y} width={width} height={height}>
        <div
          className={styles.node}
          style={{
            padding: isImage
              ? 0
              : isText
                ? "4px 6px"
                : shape === "decision"
                  ? "24px 40px"
                  : undefined,
            justifyContent: isFrame || isText ? "flex-start" : undefined,
            textAlign: shape === "decision" ? "center" : undefined,
            borderRadius: isImage ? 6 : undefined,
          }}
        >
          {isImage && node.imageUrl ? (
            <SnapshotImage path={node.imageUrl} title={node.title} />
          ) : (
            <>
              <div className={isText ? undefined : styles.title}>
                {isText
                  ? node.notes?.trim() || node.title || "Text"
                  : node.title.trim() || (isFrame ? "Group" : "Untitled node")}
              </div>
              {!isText && !isFrame && node.notes ? (
                <div className={styles.notes}>{node.notes}</div>
              ) : null}
              {typeof node.timestampSeconds === "number" ? (
                <div className={styles.timestamp}>
                  {formatVideoTimestamp(node.timestampSeconds)}
                </div>
              ) : null}
            </>
          )}
        </div>
      </foreignObject>
    </g>
  );
});

/** A lightweight cropped view: no second React Flow editor or screenshot cache. */
export function NoteGraphSnapshotPreview({
  graph,
  bounds,
  label = "Graph snapshot",
}: {
  graph: NoteGraph;
  bounds: Pick<NoteGraphSnapshot, "x" | "y" | "width" | "height">;
  label?: string;
}) {
  const id = useId().replace(/:/g, "");
  const { x, y, width, height } = bounds;
  const { nodes, edges } = graph;
  const { grid, snap } = resolveNoteGraphViewPreferences(graph);
  const gridGap = noteGraphGridGap(snap);
  const scene = useMemo(
    () => createNoteGraphSnapshotScene({ nodes, edges }, { x, y, width, height }),
    [nodes, edges, x, y, width, height],
  );
  return (
    <svg
      className={styles.preview}
      viewBox={`${x} ${y} ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      aria-describedby={`${id}-description`}
    >
      <desc id={`${id}-description`}>
        {scene.nodes.length || scene.edges.length
          ? [
              ...scene.nodes.map((node) =>
                node.shape === "text"
                  ? node.notes || node.title
                  : [node.title, node.notes].filter(Boolean).join(": "),
              ),
              ...scene.edges.flatMap(({ edge }) => (edge.label ? [edge.label] : [])),
            ].join(". ")
          : "Empty canvas area. Content added here appears automatically."}
      </desc>
      <defs>
        <pattern id={`${id}-grid`} width={gridGap} height={gridGap} patternUnits="userSpaceOnUse">
          <path
            d={`M ${gridGap} 0 H 0 V ${gridGap}`}
            fill="none"
            stroke={grid === "lines" ? "var(--app-border)" : "var(--canvas-grid-line)"}
            strokeWidth={grid === "lines" ? 0.5 : 1}
          />
        </pattern>
        {scene.edges.map(({ edge }) => {
          const color = resolveNoteGraphEdgePaint(edge).stroke;
          return (
            <marker
              key={edge.id}
              id={`${id}-arrow-${edge.id}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
            </marker>
          );
        })}
      </defs>
      <rect x={x} y={y} width={width} height={height} fill="var(--app-page)" />
      {grid !== "off" ? (
        <rect x={x} y={y} width={width} height={height} fill={`url(#${id}-grid)`} />
      ) : null}
      {scene.nodes
        .filter((node) => node.shape === "frame")
        .map((node) => (
          <SnapshotNode key={node.id} node={node} />
        ))}
      {scene.edges.map(({ edge, path, labelX, labelY }) => {
        const paint = resolveNoteGraphEdgePaint(edge);
        const arrow = `url(#${id}-arrow-${edge.id})`;
        return (
          <g key={edge.id} data-snapshot-edge={edge.id}>
            <path
              d={path}
              fill="none"
              stroke={paint.stroke}
              strokeWidth={paint.width}
              strokeDasharray={paint.dash}
              markerEnd={paint.arrowEnd ? arrow : undefined}
              markerStart={paint.arrowStart ? arrow : undefined}
            />
            {edge.label ? (
              <g>
                <rect
                  {...noteGraphEdgeLabelBox(edge.label, labelX, labelY)}
                  rx="4"
                  fill="var(--app-page)"
                />
                <text
                  x={labelX}
                  y={labelY + 4}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--app-text)"
                >
                  {edge.label}
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
      {scene.nodes
        .filter((node) => node.shape !== "frame")
        .map((node) => (
          <SnapshotNode key={node.id} node={node} />
        ))}
    </svg>
  );
}

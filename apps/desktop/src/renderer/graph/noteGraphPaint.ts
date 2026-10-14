/**
 * How connectors and node outlines are painted, for every place that draws a graph: the
 * canvas, the in-note snapshot preview and the SVG/PNG export.
 */
import { noteGraphColorHex } from "@loam/shared/notes/noteGraphColors";
import { getNoteGraphNodeSize } from "@loam/shared/notes/noteGraphGeometry";
import type { NoteGraphEdge, NoteGraphNode } from "@loam/shared/notes/noteModel";
import { clamp } from "../lib/clamp";

/** A connector without a colour of its own. */
const noteGraphEdgeDefaultColor = noteGraphColorHex.gray;

export const noteGraphEdgeDefaultWidth = 1.8;

/**
 * A connector's stroke, width, dash and which ends carry an arrow. `fallbackStroke` colours
 * connectors without a colour, so the canvas can follow the theme.
 */
export const resolveNoteGraphEdgePaint = (
  edge: Pick<NoteGraphEdge, "color" | "width" | "dashed" | "direction">,
  fallbackStroke: string = noteGraphEdgeDefaultColor,
) => {
  const direction = edge.direction ?? "end";
  return {
    stroke: edge.color ? noteGraphColorHex[edge.color] : fallbackStroke,
    width: clamp(edge.width ?? noteGraphEdgeDefaultWidth, 1, 4),
    dash: edge.dashed ? "7 5" : undefined,
    arrowStart: direction === "start" || direction === "both",
    arrowEnd: direction === "end" || direction === "both",
  };
};

/** The box behind a connector label centred on (x, y), sized for 11px text. */
export const noteGraphEdgeLabelBox = (label: string, x: number, y: number) => ({
  x: x - label.length * 3.2 - 6,
  y: y - 10,
  width: label.length * 6.4 + 12,
  height: 20,
});

/** The outline a node draws in, or null for text, which draws none. */
export type NoteGraphNodeOutline =
  | { kind: "diamond"; points: string }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "rect"; x: number; y: number; width: number; height: number; rx: number }
  | null;

export const resolveNoteGraphNodeOutline = (node: NoteGraphNode): NoteGraphNodeOutline => {
  const { width, height } = getNoteGraphNodeSize(node);
  const { x, y } = node.position;
  const shape = node.shape ?? "process";
  if (shape === "text") return null;
  if (shape === "decision") {
    return {
      kind: "diamond",
      points: `${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}`,
    };
  }
  if (shape === "ellipse") {
    return {
      kind: "ellipse",
      cx: x + width / 2,
      cy: y + height / 2,
      rx: width / 2,
      ry: height / 2,
    };
  }
  const rx = shape === "terminator" ? Math.min(width, height) / 2 : shape === "sticky" ? 3 : 6;
  return { kind: "rect", x, y, width, height, rx };
};

/** Outline and ghost nodes leave the background showing; ghosts also dash their outline. */
export const resolveNoteGraphNodeVariantPaint = (node: Pick<NoteGraphNode, "variant">) => ({
  tinted: node.variant !== "outline" && node.variant !== "ghost",
  dash: node.variant === "ghost" ? "6 4" : undefined,
});

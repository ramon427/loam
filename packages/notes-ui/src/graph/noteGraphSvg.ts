import { getNoteGraphNodeSize } from "@loam/shared/notes/noteGraphGeometry";
import { resolveNoteGraphNodeHex } from "@loam/shared/notes/noteGraphColors";
import { formatVideoTimestamp } from "@loam/shared/notes/noteVideo";
import type { NoteGraph, NoteGraphNode } from "@loam/shared/notes/noteModel";

import { findCollapsedFrameHiddenNodeIds } from "./noteGraphFrames";
import { getNoteGraphBounds } from "./noteGraphGeometry";
import {
  noteGraphEdgeLabelBox,
  resolveNoteGraphEdgePaint,
  resolveNoteGraphNodeOutline,
  resolveNoteGraphNodeVariantPaint,
} from "./noteGraphPaint";
import { createNoteGraphSnapshotScene } from "./noteGraphSnapshotScene";

type GraphParts = Pick<NoteGraph, "nodes" | "edges">;

// Exported SVGs can't read the app's CSS variables, so mirror --font-ui and --font-code from app.css.
const SVG_FONT_UI = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
const SVG_FONT_CODE =
  "ui-monospace, 'SF Mono', 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace";

const escapeNoteGraphXml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const wrapNoteGraphSvgText = (text: string, maxChars: number, maxLines: number) => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]!.replace(/\.*$/, "")}…`;
    return kept;
  }
  return lines;
};

/** The area an exported image covers: the nodes the canvas draws, with a margin. */
export const noteGraphExportBounds = (graph: GraphParts) => {
  const hidden = findCollapsedFrameHiddenNodeIds(graph.nodes);
  return getNoteGraphBounds(
    graph.nodes.filter((node) => !hidden.has(node.id)),
    48,
  );
};

const outlineSvg = (node: NoteGraphNode, paint: string) => {
  const outline = resolveNoteGraphNodeOutline(node);
  if (!outline) return "";
  if (outline.kind === "diamond") return `<polygon points="${outline.points}"${paint}/>`;
  if (outline.kind === "ellipse") {
    return `<ellipse cx="${outline.cx}" cy="${outline.cy}" rx="${outline.rx}" ry="${outline.ry}"${paint}/>`;
  }
  return `<rect x="${outline.x}" y="${outline.y}" width="${outline.width}" height="${outline.height}" rx="${outline.rx}"${paint}/>`;
};

const nodeSvg = (node: NoteGraphNode): string => {
  const size = getNoteGraphNodeSize(node);
  const { x, y } = node.position;
  const hex = resolveNoteGraphNodeHex(node);
  const shape = node.shape ?? "process";
  if (shape === "text") {
    const noteLines = wrapNoteGraphSvgText(
      node.notes?.trim() || node.title,
      Math.max(8, Math.floor(size.width / 5.6)),
      8,
    );
    return noteLines
      .map(
        (line, index) =>
          `<text x="${x + 4}" y="${y + 16 + index * 14}" font-family="${SVG_FONT_UI}" font-size="11" fill="#334155">${escapeNoteGraphXml(line)}</text>`,
      )
      .join("");
  }
  if (shape === "frame") {
    return [
      outlineSvg(
        node,
        ` fill="${hex}" fill-opacity="0.05" stroke="${hex}" stroke-opacity="0.7" stroke-width="1.6" stroke-dasharray="8 6"`,
      ),
      `<text x="${x + 12}" y="${y + 22}" font-family="${SVG_FONT_UI}" font-size="12" font-weight="700" fill="#334155">${escapeNoteGraphXml(node.title.trim() || "Group")}</text>`,
    ].join("");
  }
  const variant = resolveNoteGraphNodeVariantPaint(node);
  const fill = variant.tinted ? `fill="${hex}" fill-opacity="0.12"` : `fill="#ffffff"`;
  const dash = variant.dash ? ` stroke-dasharray="${variant.dash}"` : "";
  const outline = outlineSvg(node, ` ${fill} stroke="${hex}" stroke-width="1.8"${dash}`);
  if (shape === "image") {
    return (
      outline +
      `<text x="${x + 14}" y="${y + 22}" font-family="${SVG_FONT_UI}" font-size="11" fill="#64748b">[image] ${escapeNoteGraphXml(node.title.trim())}</text>`
    );
  }
  const title = wrapNoteGraphSvgText(
    node.title.trim() || "Untitled node",
    Math.max(8, Math.floor((size.width - 28) / 6.6)),
    4,
  )
    .map(
      (line, index) =>
        `<text x="${x + 14}" y="${y + 22 + index * 15}" font-family="${SVG_FONT_UI}" font-size="12" font-weight="600" fill="#0f172a">${escapeNoteGraphXml(line)}</text>`,
    )
    .join("");
  const timestamp =
    typeof node.timestampSeconds === "number"
      ? `<text x="${x + 14}" y="${y + size.height - 10}" font-family="${SVG_FONT_CODE}" font-size="10" fill="#475569">${formatVideoTimestamp(node.timestampSeconds)}</text>`
      : "";
  return outline + title + timestamp;
};

/**
 * A standalone SVG of the graph on a light background: what the canvas draws, with
 * connectors routed like the snapshot preview, and images shown by name. It holds no
 * <foreignObject>: PNG export draws this SVG onto a canvas, and Chromium taints a canvas
 * that drew an SVG containing one, so the PNG could not be read back.
 */
export const buildNoteGraphSvg = (graph: GraphParts): string => {
  const bounds = noteGraphExportBounds(graph);
  const scene = createNoteGraphSnapshotScene(graph, bounds);
  const colors = Array.from(
    new Set(scene.edges.map(({ edge }) => resolveNoteGraphEdgePaint(edge).stroke)),
  );
  const markers = colors
    .map(
      (color, index) =>
        `<marker id="arrow-${index}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/></marker>`,
    )
    .join("");
  const edgeParts = scene.edges.flatMap(({ edge, path, labelX, labelY }) => {
    const paint = resolveNoteGraphEdgePaint(edge);
    const arrow = `url(#arrow-${colors.indexOf(paint.stroke)})`;
    const parts = [
      `<path d="${path}" fill="none" stroke="${paint.stroke}" stroke-width="${paint.width}"${
        paint.dash ? ` stroke-dasharray="${paint.dash}"` : ""
      }${paint.arrowEnd ? ` marker-end="${arrow}"` : ""}${
        paint.arrowStart ? ` marker-start="${arrow}"` : ""
      }/>`,
    ];
    if (edge.label) {
      const box = noteGraphEdgeLabelBox(edge.label, labelX, labelY);
      parts.push(
        `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="4" fill="#ffffff" fill-opacity="0.95"/>`,
        `<text x="${labelX}" y="${labelY + 4}" text-anchor="middle" font-family="${SVG_FONT_UI}" font-size="11" font-weight="600" fill="#0f172a">${escapeNoteGraphXml(edge.label)}</text>`,
      );
    }
    return parts;
  });
  // Frames sit below connectors and connectors below other nodes, as in the preview.
  const frames = scene.nodes.filter((node) => node.shape === "frame").map(nodeSvg);
  const others = scene.nodes.filter((node) => node.shape !== "frame").map(nodeSvg);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(bounds.width)}" height="${Math.round(bounds.height)}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}">`,
    `<defs>${markers}</defs>`,
    `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#ffffff"/>`,
    ...frames,
    ...edgeParts,
    ...others,
    `</svg>`,
  ].join("");
};

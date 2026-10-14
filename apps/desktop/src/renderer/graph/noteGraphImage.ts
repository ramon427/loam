import { buildNoteGraphSvg, noteGraphExportBounds } from "./noteGraphSvg";
import type { NoteGraph } from "@loam/shared/notes/noteModel";

type GraphParts = Pick<NoteGraph, "nodes" | "edges">;

/** Exported images are drawn at twice the graph's size... */
const IMAGE_SCALE = 2;
/** ...but no side may pass this many pixels, which browsers refuse to allocate. */
const IMAGE_MAX_SIDE = 8192;

/** The pixel size to draw a graph at, or null when its bounds cannot be drawn. */
export function noteGraphImageSize(graph: GraphParts) {
  const bounds = noteGraphExportBounds(graph);
  if (
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return null;
  }
  const scale = Math.min(
    IMAGE_SCALE,
    IMAGE_MAX_SIDE / bounds.width,
    IMAGE_MAX_SIDE / bounds.height,
  );
  return {
    width: Math.max(1, Math.round(bounds.width * scale)),
    height: Math.max(1, Math.round(bounds.height * scale)),
  };
}

/**
 * Draws the graph's SVG export onto a white canvas, for PNG export from the toolbar and from
 * the MCP automation bridge. Rejects with a message that can be shown to the user.
 */
export async function renderNoteGraphImage(graph: GraphParts): Promise<HTMLCanvasElement> {
  const size = noteGraphImageSize(graph);
  if (!size) throw new Error("This diagram's bounds cannot be rendered as an image.");
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("The diagram could not be rendered."));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildNoteGraphSvg(graph))}`;
  });
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("PNG export needs browser canvas support.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export const canvasToPngBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The image could not be created."))),
      "image/png",
    ),
  );

/** Saves a file through the browser's download. */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

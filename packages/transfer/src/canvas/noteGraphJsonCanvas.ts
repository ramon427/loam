import type { NoteGraph, NoteGraphEdge, NoteGraphNode } from "@loam/shared/notes/noteModel";
import { createUuid } from "@loam/shared/utils/uuid";
import { isSafeImageReference } from "@loam/shared/notes/imageReferences";
import {
  noteGraphImageNodeDefaultSize,
  noteGraphNodeDefaultSize,
  clampNoteGraphNodeSize,
  getNoteGraphNodeSize,
} from "@loam/shared/notes/noteGraphGeometry";
import { noteGraphColorHex, resolveNoteGraphNodeHex } from "@loam/shared/notes/noteGraphColors";

/* ------------------------------------------------------------------------ */
/* JSON Canvas export/import (https://jsoncanvas.org)                        */
/* ------------------------------------------------------------------------ */
const IMAGE_FILE_PATTERN = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i;

// Image nodes travel as JSON Canvas file nodes that reference the image's storage path.
// The path stays private: only its owner can load it again, nothing is made public.
const toJsonCanvasContent = (node: NoteGraphNode) => {
  if (node.shape === "image" && node.imageUrl) return { type: "file", file: node.imageUrl };
  const text = node.notes?.trim() ? `${node.title}\n\n${node.notes.trim()}` : node.title;
  return { type: node.shape === "frame" ? "group" : "text", text };
};

const resolveImportedShape = (type: string, imageUrl: string | null): NoteGraphNode["shape"] => {
  if (imageUrl) return "image";
  return type === "group" ? "frame" : "process";
};

export const buildNoteGraphJsonCanvas = (graph: Pick<NoteGraph, "nodes" | "edges">): string => {
  const nodes = graph.nodes.map((node) => {
    const size = getNoteGraphNodeSize(node);
    return {
      id: node.id,
      ...toJsonCanvasContent(node),
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
      width: Math.round(size.width),
      height: Math.round(size.height),
      color: resolveNoteGraphNodeHex(node),
    };
  });
  const edges = graph.edges.map((edge) => ({
    id: edge.id,
    fromNode: edge.source,
    toNode: edge.target,
    ...(edge.label ? { label: edge.label } : {}),
    ...(edge.color ? { color: noteGraphColorHex[edge.color] } : {}),
  }));
  return JSON.stringify({ nodes, edges }, null, 2);
};

const readNumber = (value: unknown) => (typeof value === "number" ? value : undefined);

const parseJsonCanvasNode = (raw: Record<string, unknown>): NoteGraphNode | null => {
  const type = typeof raw.type === "string" ? raw.type : "text";
  if (type !== "text" && type !== "group" && type !== "file") return null;
  const file = type === "file" && typeof raw.file === "string" ? raw.file.trim() : "";
  // Only a storage image reference becomes an image; other files keep their name as text.
  const imageUrl =
    file && IMAGE_FILE_PATTERN.test(file) && isSafeImageReference(file) ? file : null;
  const content = typeof raw.text === "string" ? raw.text : (file.split("/").pop() ?? "");
  const [firstLine, ...rest] = content.split("\n");
  const colorHex =
    typeof raw.color === "string" && raw.color.startsWith("#") ? raw.color : undefined;
  const defaultSize = imageUrl ? noteGraphImageNodeDefaultSize : noteGraphNodeDefaultSize;
  return {
    id: createUuid(),
    title: imageUrl ? "Image" : (firstLine ?? "").trim().slice(0, 120) || "Imported node",
    ...(rest.length ? { notes: rest.join("\n").trim() || undefined } : {}),
    color: "blue",
    ...(colorHex ? { colorHex } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    shape: resolveImportedShape(type, imageUrl),
    size: clampNoteGraphNodeSize({
      width: readNumber(raw.width) ?? defaultSize.width,
      height: readNumber(raw.height) ?? defaultSize.height,
    }),
    position: { x: Math.round(readNumber(raw.x) ?? 80), y: Math.round(readNumber(raw.y) ?? 80) },
  };
};

export const parseNoteGraphJsonCanvas = (
  text: string,
): {
  nodes: NoteGraphNode[];
  edges: NoteGraphEdge[];
} => {
  const parsed = JSON.parse(text) as {
    nodes?: Array<Record<string, unknown>>;
    edges?: Array<Record<string, unknown>>;
  };
  if (!parsed || !Array.isArray(parsed.nodes)) {
    throw new Error("Not a JSON Canvas file: missing a nodes array.");
  }
  const nodes: NoteGraphNode[] = [];
  const idMap = new Map<string, string>();
  parsed.nodes.forEach((raw) => {
    const id = typeof raw.id === "string" ? raw.id : null;
    const node = id ? parseJsonCanvasNode(raw) : null;
    if (!id || !node) return;
    idMap.set(id, node.id);
    nodes.push(node);
  });
  const edges: NoteGraphEdge[] = [];
  (parsed.edges ?? []).forEach((raw) => {
    const from = typeof raw.fromNode === "string" ? idMap.get(raw.fromNode) : null;
    const to = typeof raw.toNode === "string" ? idMap.get(raw.toNode) : null;
    if (!from || !to) return;
    edges.push({
      id: createUuid(),
      source: from,
      target: to,
      ...(typeof raw.label === "string" && raw.label.trim() ? { label: raw.label.trim() } : {}),
    });
  });
  return { nodes, edges };
};

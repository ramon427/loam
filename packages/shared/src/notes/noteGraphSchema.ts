import { z } from "zod";
import {
  MAX_NOTE_HEADING_CONNECTIONS_PER_TARGET,
  normalizeNoteHeadingBlockIds,
} from "./headingConnections";
import { imageReferenceSchema } from "./imageReferences";
import { isNoteGraphHexColor, noteGraphNodeColors } from "./noteGraphColors";
import { noteGraphNodeSizeLimits } from "./noteGraphGeometry";

/** The most nodes a graph holds; the editor stops adding nodes there. */
export const MAX_NOTE_GRAPH_NODES = 200;

const finiteNonnegativeNumberSchema = z.number().finite().nonnegative();

const noteGraphNodeColorSchema = z.enum(noteGraphNodeColors);

const noteGraphNodeShapeSchema = z.enum([
  "process",
  "terminator",
  "decision",
  "ellipse",
  "sticky",
  "text",
  "image",
  "frame",
]);

const noteGraphNodeVariantSchema = z.enum(["filled", "outline", "ghost"]);

const noteGraphNodeColorHexSchema = z
  .string()
  .trim()
  .refine(isNoteGraphHexColor, "Use a hex color such as #0ea5e9.");

// Graphs saved while this schema allowed nodes 520 tall may still hold them, and an AI
// client that reads such a graph must be able to write it back unchanged.
const storedMaxNodeHeight = Math.max(noteGraphNodeSizeLimits.maxHeight, 520);

const noteGraphNodeSizeSchema = z.object({
  width: z
    .number()
    .finite()
    .min(noteGraphNodeSizeLimits.minWidth)
    .max(noteGraphNodeSizeLimits.maxWidth),
  height: z.number().finite().min(noteGraphNodeSizeLimits.minHeight).max(storedMaxNodeHeight),
});

const deduplicateHeadingBlockIds = (value: unknown) => {
  if (!Array.isArray(value)) return value;

  const seen = new Set<string>();
  return value.flatMap((candidate) => {
    if (typeof candidate !== "string") return [candidate];
    const normalized = candidate.trim();
    if (seen.has(normalized)) return [];
    seen.add(normalized);
    return [normalized];
  });
};

const noteHeadingBlockIdsSchema = z
  .preprocess(
    deduplicateHeadingBlockIds,
    z.array(z.string().min(1).max(120)).max(MAX_NOTE_HEADING_CONNECTIONS_PER_TARGET).optional(),
  )
  .transform(normalizeNoteHeadingBlockIds);

const noteGraphNodeSchema = z.object({
  id: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(120),
  headingBlockIds: noteHeadingBlockIdsSchema.optional(),
  notes: z.string().trim().max(1000).optional(),
  color: noteGraphNodeColorSchema.optional(),
  shape: noteGraphNodeShapeSchema.optional(),
  size: noteGraphNodeSizeSchema.optional(),
  imageUrl: imageReferenceSchema.optional(),
  timestampSeconds: finiteNonnegativeNumberSchema.optional(),
  colorHex: noteGraphNodeColorHexSchema.optional(),
  variant: noteGraphNodeVariantSchema.optional(),
  locked: z.boolean().optional(),
  collapsed: z.boolean().optional(),
  expandedSize: noteGraphNodeSizeSchema.optional(),
  position: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
  }),
});

const noteGraphEdgeSchema = z.object({
  id: z.string().trim().min(1).max(120),
  source: z.string().trim().min(1).max(120),
  target: z.string().trim().min(1).max(120),
  label: z.string().trim().max(120).optional(),
  type: z.enum(["smoothstep", "straight", "bezier", "step"]).optional(),
  direction: z.enum(["none", "end", "start", "both"]).optional(),
  color: noteGraphNodeColorSchema.optional(),
  dashed: z.boolean().optional(),
  width: z.number().finite().min(1).max(4).optional(),
  locked: z.boolean().optional(),
});

const noteGraphViewportSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  zoom: z.number().finite().positive(),
});

/**
 * A graph as AI clients and graph imports must send it: within the editor's
 * limits, with unique node ids and edges between existing nodes.
 */
export const noteGraphSchema = z
  .object({
    enabled: z.boolean(),
    nodes: z.array(noteGraphNodeSchema).max(MAX_NOTE_GRAPH_NODES),
    edges: z.array(noteGraphEdgeSchema).max(400),
    viewport: noteGraphViewportSchema.optional(),
    grid: z.enum(["dots", "lines", "off"]).optional(),
    snap: z.boolean().optional(),
    scrollMode: z.enum(["zoom", "pan"]).optional(),
    theme: z.enum(["default", "blueprint", "warm"]).optional(),
  })
  .superRefine((graph, ctx) => {
    const nodeIds = new Set<string>();
    graph.nodes.forEach((node, index) => {
      if (nodeIds.has(node.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes", index, "id"],
          message: "Graph node ids must be unique.",
        });
      }
      nodeIds.add(node.id);
    });

    graph.edges.forEach((edge, index) => {
      if (!nodeIds.has(edge.source)) {
        ctx.addIssue({
          code: "custom",
          path: ["edges", index, "source"],
          message: "Graph edge source must reference a graph node.",
        });
      }
      if (!nodeIds.has(edge.target)) {
        ctx.addIssue({
          code: "custom",
          path: ["edges", index, "target"],
          message: "Graph edge target must reference a graph node.",
        });
      }
    });
  });

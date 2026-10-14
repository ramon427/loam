import { z } from "zod";

import { noteGraphSchema } from "@loam/shared/notes/noteGraphSchema";
import type { NoteGraph } from "@loam/shared/notes/noteModel";
import { StoreError } from "@loam/storage/storeError";
import {
  buildNoteGraphJsonCanvas,
  parseNoteGraphJsonCanvas,
} from "@loam/transfer/canvas/noteGraphJsonCanvas";
import { buildNoteGraphMermaid } from "@loam/transfer/markdown/noteGraphMermaid";
import { parseNoteGraphMermaid } from "@loam/transfer/markdown/parseNoteGraphMermaid";

import { idSchema } from "../requests/params";
import type { ToolContext, ToolDefinition } from "./tools";

/** Tools that set, build, arrange, import and export a diagram tab. */
export const graphTools = ({
  app,
  define,
  fullNote,
  patchTab,
  noteId,
  baseUpdatedAt,
  withNotes,
}: ToolContext): ToolDefinition[] => [
  define(
    "loam_graphs_set",
    "Replace one diagram, including shapes, frames, connections, labels, images, heading links, video timestamps, locked/collapsed state and view settings.",
    { ...noteId, tabId: idSchema, graph: noteGraphSchema, baseUpdatedAt },
    (input) => patchTab(input.noteId, input.tabId, input.baseUpdatedAt, "graph", input.graph),
    withNotes,
  ),
  define(
    "loam_graphs_templates",
    "List the app's diagram templates, or build one by templateId. Apply a built graph with graphs_set.",
    { templateId: idSchema.optional() },
    ({ templateId }) => app.workspace.request({ action: "graphTemplates", templateId }),
    { readOnly: true },
  ),
  define(
    "loam_graphs_layout",
    "Apply the app's tidy or grid layout to a diagram tab while preserving locked node positions.",
    { ...noteId, tabId: idSchema, mode: z.enum(["tidy", "grid"]), baseUpdatedAt },
    async (input) => {
      const graph = (await fullNote(input.noteId)).graphsByTab?.[input.tabId];
      if (!graph) throw new StoreError("Diagram tab not found.", "NOT_FOUND", 404);
      const arranged = (await app.workspace.request({
        action: "layoutGraph",
        graph,
        mode: input.mode,
      })) as NoteGraph;
      return patchTab(input.noteId, input.tabId, input.baseUpdatedAt, "graph", arranged);
    },
    withNotes,
  ),
  define(
    "loam_graphs_import",
    "Parse Mermaid or JSON Canvas into one diagram tab, replacing that tab's diagram. Other tabs are preserved.",
    {
      ...noteId,
      tabId: idSchema,
      format: z.enum(["mermaid", "jsoncanvas"]),
      text: z.string().max(5 * 1024 * 1024),
      baseUpdatedAt,
    },
    (input) => {
      const parsed =
        input.format === "mermaid"
          ? parseNoteGraphMermaid(input.text)
          : parseNoteGraphJsonCanvas(input.text);
      return patchTab(
        input.noteId,
        input.tabId,
        input.baseUpdatedAt,
        "graph",
        noteGraphSchema.parse({ enabled: true, ...parsed }),
      );
    },
    withNotes,
  ),
  define(
    "loam_graphs_export",
    "Export a diagram tab as Mermaid, JSON Canvas, SVG or PNG. PNG returns base64 image data.",
    { ...noteId, tabId: idSchema, format: z.enum(["mermaid", "jsoncanvas", "svg", "png"]) },
    async (input) => {
      const graph = (await fullNote(input.noteId)).graphsByTab?.[input.tabId];
      if (!graph) throw new StoreError("Diagram tab not found.", "NOT_FOUND", 404);
      if (input.format === "mermaid")
        return { text: buildNoteGraphMermaid(graph), mimeType: "text/plain" };
      if (input.format === "jsoncanvas")
        return { text: buildNoteGraphJsonCanvas(graph), mimeType: "application/json" };
      return app.workspace.request({ action: "exportGraph", graph, format: input.format });
    },
    { readOnly: true, flushFirst: true },
    (input) => input.format === "png",
  ),
];

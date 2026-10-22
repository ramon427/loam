import { noteGraphSchema } from "@loam/shared/notes/noteGraphSchema";
import { parseNoteGraphJsonCanvas } from "@loam/transfer/canvas/noteGraphJsonCanvas";
import { parseNoteGraphMermaid } from "@loam/transfer/markdown/parseNoteGraphMermaid";
import type { NoteGraph } from "@loam/shared/notes/noteModel";
import { errorMessage } from "../lib/errorMessage";

export type NoteGraphImportFormat = "mermaid" | "jsoncanvas";

type GraphParts = Pick<NoteGraph, "nodes" | "edges">;

/**
 * Checks an import against the same schema every saved graph must pass, together with the
 * graph it joins, so it cannot add nodes or connectors that saving would reject.
 */
const findImportProblem = (existing: GraphParts, imported: GraphParts) => {
  const result = noteGraphSchema.safeParse({
    enabled: true,
    nodes: [...existing.nodes, ...imported.nodes],
    edges: [...existing.edges, ...imported.edges],
  });
  if (result.success) return null;
  const issue = result.error.issues[0];
  const [collection, index, field] = issue?.path ?? [];
  if (typeof index !== "number") return `This import cannot be saved: ${issue?.message ?? ""}`;
  const isNode = collection === "nodes";
  const importedIndex = index - (isNode ? existing.nodes.length : existing.edges.length);
  const item = `${isNode ? "Node" : "Connector"} ${importedIndex + 1}`;
  return `${item}${typeof field === "string" ? ` ${field}` : ""}: ${issue?.message ?? "invalid"}`;
};

/** Parses pasted Mermaid or JSON Canvas text into nodes that can join `existing`. */
export function readNoteGraphImport(
  format: NoteGraphImportFormat,
  text: string,
  existing: GraphParts,
): { parts: GraphParts } | { error: string } {
  try {
    const parts =
      format === "mermaid" ? parseNoteGraphMermaid(text) : parseNoteGraphJsonCanvas(text);
    if (parts.nodes.length === 0) return { error: "Nothing to import: no nodes were found." };
    const problem = findImportProblem(existing, parts);
    return problem ? { error: problem } : { parts };
  } catch (error) {
    return { error: errorMessage(error, "Import failed") };
  }
}

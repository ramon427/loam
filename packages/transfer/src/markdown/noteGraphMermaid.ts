import type { NoteGraph, NoteGraphNode } from "@loam/shared/notes/noteModel";

/**
 * Characters that would end or reinterpret a quoted Mermaid label, written as
 * Mermaid entity codes. `#` goes first so an existing code is not decoded twice.
 */
const escapeMermaidLabel = (text: string) =>
  text
    .replace(/[#"[\]{}()|<>]/g, (character) =>
      character === '"' ? "#quot;" : `#${character.codePointAt(0)};`,
    )
    .replace(/\s*\n\s*/g, " ")
    .trim();

const nodeShape = (node: NoteGraphNode, label: string) => {
  switch (node.shape) {
    case "decision":
      return `{"${label}"}`;
    case "terminator":
    case "ellipse":
      return `("${label}")`;
    default:
      return `["${label}"]`;
  }
};

const edgeArrow = (direction: string | undefined, dashed: boolean | undefined) => {
  if (direction === "none") return dashed ? "-.-" : "---";
  if (direction === "both") return "<-->";
  return dashed ? "-.->" : "-->";
};

/**
 * A Mermaid flowchart for a note's diagram. Frames are visual grouping only, so
 * they become comments; the `.canvas` file keeps the full layout.
 */
export const buildNoteGraphMermaid = (graph: Pick<NoteGraph, "nodes" | "edges">) => {
  const ids = new Map<string, string>();
  const lines = ["flowchart TD"];
  for (const node of graph.nodes) {
    const label = escapeMermaidLabel(node.title || "Untitled");
    if (node.shape === "frame") {
      lines.push(`  %% frame: ${label}`);
      continue;
    }
    const id = `n${ids.size}`;
    ids.set(node.id, id);
    lines.push(`  ${id}${nodeShape(node, label)}`);
  }
  for (const edge of graph.edges) {
    let source = ids.get(edge.source);
    let target = ids.get(edge.target);
    if (!source || !target) continue;
    // Mermaid has no "arrow at the start", so the edge is written the other way round.
    if (edge.direction === "start") [source, target] = [target, source];
    const label = edge.label?.trim() ? `|"${escapeMermaidLabel(edge.label)}"| ` : "";
    lines.push(`  ${source} ${edgeArrow(edge.direction, edge.dashed)} ${label}${target}`);
  }
  return lines.join("\n");
};

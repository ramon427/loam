import type {
  NoteGraphEdge,
  NoteGraphEdgeDirection,
  NoteGraphNode,
} from "@loam/shared/notes/noteModel";
import { createUuid } from "@loam/shared/utils/uuid";
import { estimateNoteGraphNodeSize } from "@loam/shared/notes/noteGraphGeometry";

/* ------------------------------------------------------------------------ */
/* Mermaid flowchart import                                                  */
/* ------------------------------------------------------------------------ */
/**
 * Labels may be quoted (`A["x: y"]`) and use Mermaid entity codes such as
 * `#quot;` or `#91;` for characters that would end the label.
 */
const readMermaidLabel = (raw: string | undefined) => {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const unquoted = /^"([\s\S]*)"$/.exec(trimmed)?.[1] ?? trimmed;
  return (
    unquoted
      .replace(/#(quot|\d{1,6});/g, (_, code: string) =>
        code === "quot" ? '"' : String.fromCodePoint(Number(code)),
      )
      .trim() || undefined
  );
};

const parseMermaidNodeToken = (
  token: string,
): {
  id: string;
  label?: string;
} => {
  const match = token.match(/^([A-Za-z0-9_]+)(?:\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})?$/);
  if (!match) return { id: token };
  return { id: match[1]!, label: readMermaidLabel(match[2] ?? match[3] ?? match[4]) };
};

const MERMAID_EDGE_DIRECTIONS: Record<string, NoteGraphEdgeDirection> = {
  "---": "none",
  "-.-": "none",
  "<-->": "both",
};

/** Minimal flowchart import: A[Label] --> B[Label], A -->|text| B, A --- B. */
export const parseNoteGraphMermaid = (
  text: string,
): {
  nodes: NoteGraphNode[];
  edges: NoteGraphEdge[];
} => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("%%"));
  const titleById = new Map<string, string>();
  const edgeSpecs: Array<{
    source: string;
    target: string;
    label?: string;
    direction: NoteGraphEdgeDirection;
  }> = [];
  const edgePattern = /^(.+?)\s*(<-->|-->|---|-\.->|-\.-|==>)\s*(?:\|([^|]*)\|\s*)?(.+)$/;
  lines.forEach((line, index) => {
    if (index === 0 && /^(graph|flowchart)\b/.test(line)) return;
    const edgeMatch = line.match(edgePattern);
    if (edgeMatch) {
      const source = parseMermaidNodeToken(edgeMatch[1]!.trim());
      const target = parseMermaidNodeToken(edgeMatch[4]!.trim());
      if (source.label && !titleById.has(source.id)) {
        titleById.set(source.id, source.label);
      }
      if (target.label && !titleById.has(target.id)) {
        titleById.set(target.id, target.label);
      }
      titleById.set(source.id, titleById.get(source.id) ?? source.id);
      titleById.set(target.id, titleById.get(target.id) ?? target.id);
      edgeSpecs.push({
        source: source.id,
        target: target.id,
        label: readMermaidLabel(edgeMatch[3]),
        direction: MERMAID_EDGE_DIRECTIONS[edgeMatch[2]!] ?? "end",
      });
      return;
    }
    const single = parseMermaidNodeToken(line.replace(/;$/, ""));
    if (!titleById.has(single.id)) {
      titleById.set(single.id, single.label ?? single.id);
    }
  });
  if (titleById.size === 0) {
    throw new Error("No Mermaid flowchart nodes found.");
  }
  const idMap = new Map<string, string>();
  const nodes: NoteGraphNode[] = Array.from(titleById.entries()).map(
    ([externalId, title], index) => {
      const node: NoteGraphNode = {
        id: createUuid(),
        title: title.slice(0, 120) || "Node",
        color: "blue",
        shape: "process",
        size: estimateNoteGraphNodeSize({ title, shape: "process" }),
        position: {
          x: 80 + (index % 4) * 300,
          y: 80 + Math.floor(index / 4) * 200,
        },
      };
      idMap.set(externalId, node.id);
      return node;
    },
  );
  const edges: NoteGraphEdge[] = edgeSpecs.flatMap((spec) => {
    const source = idMap.get(spec.source);
    const target = idMap.get(spec.target);
    if (!source || !target || source === target) return [];
    return [
      {
        id: createUuid(),
        source,
        target,
        ...(spec.label ? { label: spec.label } : {}),
        ...(spec.direction !== "end" ? { direction: spec.direction } : {}),
      },
    ];
  });
  return { nodes, edges };
};

import type {
  NoteGraph,
  NoteGraphEdge,
  NoteGraphNode,
  NoteGraphNodeColor,
  NoteGraphNodeShape,
} from "@loam/shared/notes/noteModel";

/* ------------------------------------------------------------------------ */
/* Search and filter                                                         */
/* ------------------------------------------------------------------------ */
export const searchNoteGraphNodes = (nodes: NoteGraphNode[], query: string): string[] => {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return nodes
    .filter((node) => {
      const haystack = `${node.title}\n${node.notes ?? ""}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .map((node) => node.id);
};

export type NoteGraphFilter = {
  colors?: NoteGraphNodeColor[];
  shapes?: NoteGraphNodeShape[];
  hasTimestamp?: boolean;
  hasHeadings?: boolean;
  orphansOnly?: boolean;
};

export const isNoteGraphFilterActive = (filter: NoteGraphFilter): boolean =>
  Boolean(
    filter.colors?.length ||
    filter.shapes?.length ||
    filter.hasTimestamp ||
    filter.hasHeadings ||
    filter.orphansOnly,
  );

/** Matching ids; AND across dimensions, OR within a list dimension. */
export const filterNoteGraphNodeIds = (
  nodes: NoteGraphNode[],
  edges: readonly Pick<NoteGraphEdge, "source" | "target">[],
  filter: NoteGraphFilter,
): Set<string> => {
  const touched = new Set<string>();
  edges.forEach((edge) => {
    touched.add(edge.source);
    touched.add(edge.target);
  });
  const colorsSet = new Set(filter.colors);
  const shapesSet = new Set(filter.shapes);
  const matches = nodes.filter((node) => {
    if (filter.colors?.length && !colorsSet.has(node.color ?? "blue")) {
      return false;
    }
    if (filter.shapes?.length && !shapesSet.has(node.shape ?? "process")) {
      return false;
    }
    if (filter.hasTimestamp && typeof node.timestampSeconds !== "number") {
      return false;
    }
    if (filter.hasHeadings && !(node.headingBlockIds?.length ?? 0)) {
      return false;
    }
    if (filter.orphansOnly && touched.has(node.id)) return false;
    return true;
  });
  return new Set(matches.map((node) => node.id));
};

/* ------------------------------------------------------------------------ */
/* Summary                                                                   */
/* ------------------------------------------------------------------------ */
export const summarizeNoteGraph = (
  graph: Pick<NoteGraph, "nodes" | "edges">,
): {
  nodeCount: number;
  edgeCount: number;
  rootCount: number;
} => {
  const targets = new Set(graph.edges.map((edge) => edge.target));
  return {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    rootCount: graph.nodes.filter((node) => !targets.has(node.id)).length,
  };
};

export const formatNoteGraphSummary = (graph: Pick<NoteGraph, "nodes" | "edges">): string => {
  const summary = summarizeNoteGraph(graph);
  const roots = summary.rootCount === 1 ? "1 root" : `${summary.rootCount} roots`;
  const nodes = summary.nodeCount === 1 ? "1 node" : `${summary.nodeCount} nodes`;
  const edges = summary.edgeCount === 1 ? "1 connector" : `${summary.edgeCount} connectors`;
  return `${roots} · ${nodes} · ${edges}`;
};

/* ------------------------------------------------------------------------ */
/* Walkthrough                                                               */
/* ------------------------------------------------------------------------ */
const byPosition = (left: NoteGraphNode, right: NoteGraphNode) =>
  left.position.y - right.position.y || left.position.x - right.position.x;

/** Reading order for a walkthrough: roots first, then children by position, then the rest. */
export const buildNoteGraphWalkthroughOrder = (
  nodes: readonly NoteGraphNode[],
  edges: readonly NoteGraphEdge[],
): string[] => {
  if (nodes.length === 0) return [];

  const incoming = new Set(edges.map((edge) => edge.target));
  const adjacency = new Map<string, string[]>();
  edges.forEach((edge) => {
    const list = adjacency.get(edge.source) ?? [];
    list.push(edge.target);
    adjacency.set(edge.source, list);
  });

  const order: string[] = [];
  const visited = new Set<string>();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    order.push(id);
    const childIds = adjacency.get(id) ?? [];
    childIds
      .flatMap((target) => byId.get(target) ?? [])
      .sort(byPosition)
      .forEach((node) => visit(node.id));
  };

  const rootsFirst = [...nodes].filter((node) => !incoming.has(node.id)).sort(byPosition);
  rootsFirst.forEach((node) => visit(node.id));
  const remaining = [...nodes].sort(byPosition);
  remaining.forEach((node) => visit(node.id));
  return order;
};

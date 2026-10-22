/** Where nodes go: align and distribute, overlap repair, the layouts, cycles and clusters. */
import { createUuid } from "@loam/shared/utils/uuid";
import { getNoteGraphNodeSize } from "@loam/shared/notes/noteGraphGeometry";
import { noteGraphNodeColors } from "@loam/shared/notes/noteGraphColors";
import type {
  NoteGraph,
  NoteGraphEdge,
  NoteGraphNode,
  NoteGraphNodeColor,
  NoteGraphNodeSize,
} from "@loam/shared/notes/noteModel";

import { getNoteGraphNodeCenter } from "./noteGraphGeometry";

/** New top-left corners by node id; nodes a layout leaves alone are absent. */
export type NoteGraphPositions = Record<string, { x: number; y: number }>;

/* ------------------------------------------------------------------------ */
/* Align and distribute                                                      */
/* ------------------------------------------------------------------------ */
export type NoteGraphAlignMode = "left" | "center-x" | "right" | "top" | "center-y" | "bottom";

export const alignNoteGraphNodes = (
  nodes: NoteGraphNode[],
  ids: ReadonlySet<string>,
  mode: NoteGraphAlignMode,
): NoteGraphPositions => {
  const targets = nodes.filter((node) => ids.has(node.id));
  if (targets.length < 2) return {};
  const extents = targets.map((node) => {
    const size = getNoteGraphNodeSize(node);
    return {
      id: node.id,
      left: node.position.x,
      right: node.position.x + size.width,
      top: node.position.y,
      bottom: node.position.y + size.height,
      width: size.width,
      height: size.height,
    };
  });
  const minLeft = Math.min(...extents.map((extent) => extent.left));
  const maxRight = Math.max(...extents.map((extent) => extent.right));
  const minTop = Math.min(...extents.map((extent) => extent.top));
  const maxBottom = Math.max(...extents.map((extent) => extent.bottom));
  const midX = (minLeft + maxRight) / 2;
  const midY = (minTop + maxBottom) / 2;
  const positions: NoteGraphPositions = {};
  extents.forEach((extent) => {
    const current = nodes.find((node) => node.id === extent.id)!;
    let x = current.position.x;
    let y = current.position.y;
    if (mode === "left") x = minLeft;
    if (mode === "right") x = maxRight - extent.width;
    if (mode === "center-x") x = Math.round(midX - extent.width / 2);
    if (mode === "top") y = minTop;
    if (mode === "bottom") y = maxBottom - extent.height;
    if (mode === "center-y") y = Math.round(midY - extent.height / 2);
    if (x !== current.position.x || y !== current.position.y) {
      positions[extent.id] = { x: Math.round(x), y: Math.round(y) };
    }
  });
  return positions;
};

export type NoteGraphDistributeAxis = "horizontal" | "vertical";

export const distributeNoteGraphNodes = (
  nodes: NoteGraphNode[],
  ids: ReadonlySet<string>,
  axis: NoteGraphDistributeAxis,
): NoteGraphPositions => {
  const targets = nodes.filter((node) => ids.has(node.id));
  if (targets.length < 3) return {};
  const sorted = [...targets].sort((a, b) =>
    axis === "horizontal" ? a.position.x - b.position.x : a.position.y - b.position.y,
  );
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const firstSize = getNoteGraphNodeSize(first);
  const lastSize = getNoteGraphNodeSize(last);
  const spanStart = axis === "horizontal" ? first.position.x : first.position.y;
  const spanEnd =
    axis === "horizontal" ? last.position.x + lastSize.width : last.position.y + lastSize.height;
  const totalSize = sorted.reduce(
    (sum, node) =>
      sum +
      (axis === "horizontal"
        ? getNoteGraphNodeSize(node).width
        : getNoteGraphNodeSize(node).height),
    0,
  );
  const gap = (spanEnd - spanStart - totalSize) / (sorted.length - 1);
  const positions: NoteGraphPositions = {};
  let cursor = spanStart + (axis === "horizontal" ? firstSize.width : firstSize.height) + gap;
  for (let index = 1; index < sorted.length - 1; index += 1) {
    const node = sorted[index]!;
    const size = getNoteGraphNodeSize(node);
    const next =
      axis === "horizontal"
        ? { x: Math.round(cursor), y: node.position.y }
        : { x: node.position.x, y: Math.round(cursor) };
    if (next.x !== node.position.x || next.y !== node.position.y) {
      positions[node.id] = next;
    }
    cursor += (axis === "horizontal" ? size.width : size.height) + gap;
  }
  return positions;
};

/* ------------------------------------------------------------------------ */
/* Overlap repair and layout validation                                      */
/* ------------------------------------------------------------------------ */
const noteGraphNodesOverlap = (
  a: Pick<NoteGraphNode, "position"> & {
    size?: NoteGraphNodeSize;
  },
  b: Pick<NoteGraphNode, "position"> & {
    size?: NoteGraphNodeSize;
  },
  padding = 24,
): boolean => {
  const aSize = getNoteGraphNodeSize(a);
  const bSize = getNoteGraphNodeSize(b);
  return (
    a.position.x < b.position.x + bSize.width + padding &&
    a.position.x + aSize.width + padding > b.position.x &&
    a.position.y < b.position.y + bSize.height + padding &&
    a.position.y + aSize.height + padding > b.position.y
  );
};

/**
 * Deterministic push-apart: sorted top-left first, later nodes yield downward
 * (then rightward) until nothing overlaps. Returns only moved positions.
 */
export const repairNoteGraphOverlaps = (
  nodes: NoteGraphNode[],
  padding = 24,
): NoteGraphPositions => {
  const placed = nodes.map((node) => ({
    id: node.id,
    size: getNoteGraphNodeSize(node),
    x: node.position.x,
    y: node.position.y,
  }));
  const moved = new Map<string, { x: number; y: number }>();
  for (let pass = 0; pass < 8; pass += 1) {
    let movedAny = false;
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]!;
        const b = placed[j]!;
        if (
          !noteGraphNodesOverlap(
            { position: { x: a.x, y: a.y }, size: a.size },
            { position: { x: b.x, y: b.y }, size: b.size },
            padding,
          )
        ) {
          continue;
        }
        b.y = a.y + a.size.height + padding;
        moved.set(b.id, { x: Math.round(b.x), y: Math.round(b.y) });
        movedAny = true;
      }
    }
    if (!movedAny) break;
  }
  return Object.fromEntries(moved);
};

/* ------------------------------------------------------------------------ */
/* Layouts (explicit, undoable; never applied silently)                      */
/* ------------------------------------------------------------------------ */
/**
 * Each node's depth: the longest path to it from a node without incoming connectors. Nodes
 * in cycles, and nodes without connectors, sit at depth 0.
 */
const computeNoteGraphDepths = ({ nodes, edges }: Pick<NoteGraph, "nodes" | "edges">) => {
  const parentsByNode = new Map<string, string[]>();
  edges.forEach((edge) => {
    const parents = parentsByNode.get(edge.target) ?? [];
    parents.push(edge.source);
    parentsByNode.set(edge.target, parents);
  });
  const depthByNode = new Map<string, number>();
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let settled = true;
    nodes.forEach((node) => {
      if (depthByNode.has(node.id)) return;
      const parents = parentsByNode.get(node.id) ?? [];
      if (parents.length === 0) {
        depthByNode.set(node.id, 0);
        settled = false;
        return;
      }
      const parentDepths = parents.map((id) => depthByNode.get(id));
      if (parentDepths.some((depth) => depth === undefined)) return;
      depthByNode.set(node.id, Math.max(...(parentDepths as number[])) + 1);
      settled = false;
    });
    if (settled) break;
  }
  nodes.forEach((node) => {
    if (!depthByNode.has(node.id)) depthByNode.set(node.id, 0);
  });
  return depthByNode;
};

/** The nodes grouped by depth, shallowest first. */
const groupNoteGraphNodesByDepth = (graph: Pick<NoteGraph, "nodes" | "edges">) => {
  const depthByNode = computeNoteGraphDepths(graph);
  const groups = new Map<number, NoteGraphNode[]>();
  graph.nodes.forEach((node) => {
    const depth = depthByNode.get(node.id) ?? 0;
    groups.set(depth, [...(groups.get(depth) ?? []), node]);
  });
  return Array.from(groups.entries()).sort(([a], [b]) => a - b);
};

/** Left-to-right layered layout: one column per depth, ordered by current position. */
export const computeNoteGraphTidyLayout = (
  graph: Pick<NoteGraph, "nodes" | "edges">,
): NoteGraphPositions => {
  const positions: NoteGraphPositions = {};
  groupNoteGraphNodesByDepth(graph).forEach(([depth, column]) => {
    const ordered = [...column].sort(
      (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
    );
    let cursorY = 80;
    ordered.forEach((node) => {
      positions[node.id] = { x: 80 + depth * 340, y: cursorY };
      cursorY += getNoteGraphNodeSize(node).height + 48;
    });
  });
  return positions;
};

/** Top-down layered layout: one row per depth, ordered by current position. */
export const computeNoteGraphVerticalLayout = (
  graph: Pick<NoteGraph, "nodes" | "edges">,
): NoteGraphPositions => {
  const positions: NoteGraphPositions = {};
  let cursorY = 80;
  groupNoteGraphNodesByDepth(graph).forEach(([, row]) => {
    const ordered = [...row].sort(
      (a, b) => a.position.x - b.position.x || a.position.y - b.position.y,
    );
    const rowHeight = Math.max(...ordered.map((node) => getNoteGraphNodeSize(node).height));
    let cursorX = 80;
    ordered.forEach((node) => {
      positions[node.id] = { x: Math.round(cursorX), y: Math.round(cursorY) };
      cursorX += getNoteGraphNodeSize(node).width + 96;
    });
    cursorY += rowHeight + 96;
  });
  return positions;
};

/** Reading-order grid: cells as large as the largest node, connectors ignored. */
export const computeNoteGraphGridLayout = (nodes: readonly NoteGraphNode[]): NoteGraphPositions => {
  if (nodes.length === 0) return {};
  const ordered = [...nodes].sort(
    (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
  );
  const sizes = ordered.map(getNoteGraphNodeSize);
  const cellWidth = Math.max(...sizes.map((size) => size.width)) + 96;
  const cellHeight = Math.max(...sizes.map((size) => size.height)) + 64;
  const columns = Math.max(2, Math.ceil(Math.sqrt(ordered.length)));
  const positions: NoteGraphPositions = {};
  ordered.forEach((node, index) => {
    positions[node.id] = {
      x: 80 + (index % columns) * cellWidth,
      y: 80 + Math.floor(index / columns) * cellHeight,
    };
  });
  return positions;
};

/** Radial layout: BFS rings around the first root. */
export const computeNoteGraphRadialLayout = (
  graph: Pick<NoteGraph, "nodes" | "edges">,
): NoteGraphPositions => {
  const nodes = graph.nodes;
  if (nodes.length === 0) return {};
  const incoming = new Set(graph.edges.map((edge) => edge.target));
  const root = nodes.find((node) => !incoming.has(node.id)) ?? nodes[0]!;
  const adjacency = new Map<string, string[]>();
  graph.edges.forEach((edge) => {
    const out = adjacency.get(edge.source) ?? [];
    out.push(edge.target);
    adjacency.set(edge.source, out);
    const back = adjacency.get(edge.target) ?? [];
    back.push(edge.source);
    adjacency.set(edge.target, back);
  });
  const depthById = new Map<string, number>([[root.id, 0]]);
  const queue = [root.id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const depth = depthById.get(current)!;
    (adjacency.get(current) ?? []).forEach((next) => {
      if (depthById.has(next)) return;
      depthById.set(next, depth + 1);
      queue.push(next);
    });
  }
  nodes.forEach((node) => {
    if (!depthById.has(node.id)) depthById.set(node.id, 0);
  });
  const { x: centerX, y: centerY } = getNoteGraphNodeCenter(root);
  const positions: NoteGraphPositions = {};
  const ringGap = 300;
  for (let depth = 1; depth <= Math.max(...depthById.values()); depth += 1) {
    const ring = nodes.filter((node) => depthById.get(node.id) === depth);
    const radius = depth * ringGap;
    ring.forEach((node, index) => {
      const angle = (2 * Math.PI * index) / ring.length - Math.PI / 2;
      const size = getNoteGraphNodeSize(node);
      positions[node.id] = {
        x: Math.round(centerX + radius * Math.cos(angle) - size.width / 2),
        y: Math.round(centerY + radius * Math.sin(angle) - size.height / 2),
      };
    });
  }
  return positions;
};

/** Chronological lane for timestamped nodes; others stay untouched. */
export const computeNoteGraphTimelineLayout = (nodes: NoteGraphNode[]): NoteGraphPositions => {
  const timed = nodes
    .filter((node) => typeof node.timestampSeconds === "number")
    .sort(
      (a, b) =>
        (a.timestampSeconds ?? 0) - (b.timestampSeconds ?? 0) || a.position.y - b.position.y,
    );
  if (timed.length < 2) return {};
  const positions: NoteGraphPositions = {};
  let cursorX = 80;
  timed.forEach((node) => {
    positions[node.id] = { x: Math.round(cursorX), y: 120 };
    cursorX += getNoteGraphNodeSize(node).width + 96;
  });
  return positions;
};

/** Chain edges between consecutive timestamped nodes (playback order). */
export const buildNoteGraphPlaybackEdges = (nodes: NoteGraphNode[]): NoteGraphEdge[] => {
  const timed = nodes
    .filter((node) => typeof node.timestampSeconds === "number")
    .sort((a, b) => (a.timestampSeconds ?? 0) - (b.timestampSeconds ?? 0));
  const edges: NoteGraphEdge[] = [];
  for (let index = 0; index < timed.length - 1; index += 1) {
    edges.push({
      id: createUuid(),
      source: timed[index]!.id,
      target: timed[index + 1]!.id,
      dashed: true,
      color: "gray",
    });
  }
  return edges;
};

/* ------------------------------------------------------------------------ */
/* Cycles and clusters                                                       */
/* ------------------------------------------------------------------------ */
/** Count edges that close a directed cycle (Kahn leftover). */
export const countNoteGraphCycleEdges = (
  nodes: readonly Pick<NoteGraphNode, "id">[],
  edges: readonly Pick<NoteGraphEdge, "source" | "target">[],
): number => {
  const indegree = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  edges.forEach((edge) => {
    if (!indegree.has(edge.source) || !indegree.has(edge.target)) return;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge.target);
    outgoing.set(edge.source, list);
  });
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const settled = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (settled.has(current)) continue;
    settled.add(current);
    (outgoing.get(current) ?? []).forEach((next) => {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    });
  }
  return edges.filter((edge) => !settled.has(edge.source) && !settled.has(edge.target)).length;
};

/** Connected components (union-find) mapped to palette colors by size. */
export const resolveNoteGraphClusterColors = (
  nodes: NoteGraphNode[],
  edges: readonly Pick<NoteGraphEdge, "source" | "target">[],
): Record<string, NoteGraphNodeColor> => {
  const parent = new Map<string, string>(nodes.map((node) => [node.id, node.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let current = id;
    while (parent.get(current) !== current) {
      const next = parent.get(current)!;
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  edges.forEach((edge) => {
    if (!parent.has(edge.source) || !parent.has(edge.target)) return;
    parent.set(find(edge.source), find(edge.target));
  });
  const componentSizes = new Map<string, number>();
  nodes.forEach((node) => {
    const root = find(node.id);
    componentSizes.set(root, (componentSizes.get(root) ?? 0) + 1);
  });
  const orderedRoots = Array.from(componentSizes.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const colorByRoot = new Map<string, NoteGraphNodeColor>();
  orderedRoots.forEach(([root], index) => {
    colorByRoot.set(root, noteGraphNodeColors[index % noteGraphNodeColors.length]!);
  });
  return Object.fromEntries(nodes.map((node) => [node.id, colorByRoot.get(find(node.id))!]));
};

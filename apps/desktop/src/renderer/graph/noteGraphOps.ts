/**
 * Every graph edit the canvas makes, as pure functions of the current graph and selection.
 * An operation returns what it changes: a new graph (one undo step), a new selection, and a
 * message for the status line. Composite actions such as Tab-chaining (rename, add, connect)
 * are one operation, so they land as one transaction and one undo step.
 */
import type { NoteHeadingConnectionOption } from "../editor/noteHeadingConnections";
import { getNoteGraphNodeSize } from "@loam/shared/notes/noteGraphGeometry";
import { noteGraphNodeColors } from "@loam/shared/notes/noteGraphColors";
import { MAX_NOTE_GRAPH_NODES } from "@loam/shared/notes/noteGraphSchema";
import { createUuid } from "@loam/shared/utils/uuid";

import {
  findCollapsedFrameHiddenNodeIds,
  findNoteGraphFrameMemberIds,
  isNoteGraphFrameNode,
  noteGraphFrameDefaultSize,
  resolveNoteGraphFrameBarSize,
} from "./noteGraphFrames";
import {
  getKeyboardResizedSize,
  getNoteGraphBounds,
  snapNoteGraphNodeSizeToGrid,
  type NoteGraphResizeDirection,
} from "./noteGraphGeometry";
import {
  alignNoteGraphNodes,
  buildNoteGraphPlaybackEdges,
  computeNoteGraphTidyLayout,
  computeNoteGraphTimelineLayout,
  distributeNoteGraphNodes,
  repairNoteGraphOverlaps,
  resolveNoteGraphClusterColors,
  type NoteGraphAlignMode,
  type NoteGraphDistributeAxis,
  type NoteGraphPositions,
} from "./noteGraphLayout";
import { createNoteGraphNode, duplicateNoteGraphNode, normalizeNoteGraphEdges } from "./noteGraph";
import { formatNoteGraphSummary } from "./noteGraphQuery";
import { noteGraphReorderOptions } from "./noteGraphShapes";
import type {
  NoteGraph,
  NoteGraphEdge,
  NoteGraphNode,
  NoteGraphNodeShape,
} from "@loam/shared/notes/noteModel";

/** The first node id is the primary selection that the inspector and the note follow. */
export type NoteGraphSelection = { nodeIds: readonly string[]; edgeId: string | null };

export const emptyNoteGraphSelection: NoteGraphSelection = { nodeIds: [], edgeId: null };

export type NoteGraphState = { graph: NoteGraph; selection: NoteGraphSelection };

/** What an operation changes. A present `graph` is committed as one undo step. */
export type NoteGraphEdit = {
  graph?: NoteGraph;
  selection?: NoteGraphSelection;
  announce?: string;
  /** Nodes the canvas briefly highlights as new. */
  addedNodeIds?: readonly string[];
};

export type NoteGraphClipboard = { nodes: NoteGraphNode[]; edges: NoteGraphEdge[] };

type Point = { x: number; y: number };

const announceOnly = (announce: string): NoteGraphEdit => ({ announce });

const selectNodes = (nodeIds: readonly string[]): NoteGraphSelection => ({
  nodeIds,
  edgeId: null,
});

const replaceNodes = (graph: NoteGraph, nodes: NoteGraphNode[]): NoteGraph => ({ ...graph, nodes });

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Selected nodes that exist and are drawn, primary first. */
export const selectedNodes = ({ graph, selection }: NoteGraphState): NoteGraphNode[] => {
  const hidden = findCollapsedFrameHiddenNodeIds(graph.nodes);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return selection.nodeIds.flatMap((id) => {
    const node = byId.get(id);
    return node && !hidden.has(id) ? [node] : [];
  });
};

const selectedEdge = ({ graph, selection }: NoteGraphState) =>
  selection.edgeId ? graph.edges.find((edge) => edge.id === selection.edgeId) : undefined;

/* ------------------------------------------------------------------------ */
/* Adding                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * The one place nodes join a graph, so the node limit holds for every way of adding them.
 * Frames go below other nodes, and the new nodes become the selection.
 */
const addNodes = (
  graph: NoteGraph,
  nodes: NoteGraphNode[],
  edges: NoteGraphEdge[] = [],
): NoteGraphEdit => {
  if (nodes.length === 0) return {};
  if (graph.nodes.length + nodes.length > MAX_NOTE_GRAPH_NODES) {
    return announceOnly(`Node limit reached (${MAX_NOTE_GRAPH_NODES})`);
  }
  const all = [...graph.nodes, ...nodes];
  const nextNodes = [
    ...all.filter(isNoteGraphFrameNode),
    ...all.filter((node) => !isNoteGraphFrameNode(node)),
  ];
  const ids = nodes.map((node) => node.id);
  return {
    graph: {
      ...graph,
      nodes: nextNodes,
      edges: normalizeNoteGraphEdges([...graph.edges, ...edges], nextNodes),
    },
    selection: selectNodes(ids),
    addedNodeIds: ids,
  };
};

export const addNode = (
  { graph }: NoteGraphState,
  input: {
    shape: NoteGraphNodeShape;
    position: Point;
    patch?: Partial<NoteGraphNode>;
    /** Also connect an existing node to the new one. */
    connectFrom?: string;
  },
): NoteGraphEdit => {
  const position = { x: Math.round(input.position.x), y: Math.round(input.position.y) };
  const node: NoteGraphNode = {
    ...createNoteGraphNode(input.shape, position),
    ...input.patch,
    position,
  };
  const edges = input.connectFrom
    ? [{ id: createUuid(), source: input.connectFrom, target: node.id }]
    : [];
  return addNodes(graph, [node], edges);
};

/**
 * Tab and Shift+Tab while editing a node: save the edit, then add a connected child to the
 * right or a sibling below (connected to the same parent).
 */
export const chainNode = (
  state: NoteGraphState,
  input: {
    sourceId: string;
    kind: "child" | "sibling";
    patch?: Partial<NoteGraphNode>;
  },
): NoteGraphEdit | null => {
  const edited = input.patch ? updateNode(state, input.sourceId, input.patch) : null;
  const graph = edited?.graph ?? state.graph;
  const source = graph.nodes.find((node) => node.id === input.sourceId);
  if (!source) return edited;
  const size = getNoteGraphNodeSize(source);
  const position =
    input.kind === "child"
      ? { x: source.position.x + size.width + 96, y: source.position.y }
      : { x: source.position.x, y: source.position.y + size.height + 64 };
  const parentId =
    input.kind === "sibling"
      ? (graph.edges.find((edge) => edge.target === source.id)?.source ?? source.id)
      : source.id;
  const added = addNode(
    { graph, selection: state.selection },
    { shape: "process", position, connectFrom: parentId },
  );
  // At the node limit the edit itself still counts.
  return added.graph ? added : { ...added, graph: edited?.graph };
};

/** A connector dragged onto empty canvas creates a node centred on the drop point. */
export const addConnectedNodeAt = (
  state: NoteGraphState,
  input: { sourceId: string; center: Point },
) => {
  const size = getNoteGraphNodeSize({});
  return addNode(state, {
    shape: "process",
    position: { x: input.center.x - size.width / 2, y: input.center.y - size.height / 2 },
    connectFrom: input.sourceId,
  });
};

/** Places a template or an import to the right of the existing nodes. */
export const insertNodeSet = (
  { graph }: NoteGraphState,
  built: NoteGraphClipboard,
  label: string,
): NoteGraphEdit => {
  const incoming = getNoteGraphBounds(built.nodes, 0);
  const existing = getNoteGraphBounds(graph.nodes, 0);
  const hasNodes = graph.nodes.length > 0;
  const dx = (hasNodes ? existing.x + existing.width + 120 : 80) - incoming.x;
  const dy = (hasNodes ? existing.y : 80) - incoming.y;
  const nodes = built.nodes.map((node) => ({
    ...node,
    position: { x: Math.round(node.position.x + dx), y: Math.round(node.position.y + dy) },
  }));
  const added = addNodes(graph, nodes, built.edges);
  return added.graph ? { ...added, announce: label } : added;
};

/* ------------------------------------------------------------------------ */
/* Clipboard and duplication                                                 */
/* ------------------------------------------------------------------------ */

export const copySelection = (state: NoteGraphState): NoteGraphClipboard | null => {
  const nodes = selectedNodes(state);
  if (nodes.length === 0) return null;
  const ids = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: state.graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
  };
};

/** Copies with fresh ids; their connectors among themselves come along. */
const cloneNodes = (clipboard: NoteGraphClipboard) => {
  const idMap = new Map<string, string>();
  const nodes = clipboard.nodes.map((node) => {
    const id = createUuid();
    idMap.set(node.id, id);
    return duplicateNoteGraphNode(node, id);
  });
  const edges = clipboard.edges.flatMap((edge) => {
    const source = idMap.get(edge.source);
    const target = idMap.get(edge.target);
    return source && target ? [{ ...edge, id: createUuid(), source, target }] : [];
  });
  return { nodes, edges, idMap };
};

/** Pastes centred on `at` when given, otherwise offset from the originals. */
export const pasteClipboard = (
  { graph }: NoteGraphState,
  clipboard: NoteGraphClipboard,
  at: Point | null,
): NoteGraphEdit => {
  const copies = cloneNodes(clipboard);
  let nodes = copies.nodes;
  if (at) {
    const bounds = getNoteGraphBounds(nodes, 0);
    const dx = at.x - (bounds.x + bounds.width / 2);
    const dy = at.y - (bounds.y + bounds.height / 2);
    nodes = nodes.map((node) => ({
      ...node,
      position: { x: Math.round(node.position.x + dx), y: Math.round(node.position.y + dy) },
    }));
  }
  const added = addNodes(graph, nodes, copies.edges);
  return added.graph ? { ...added, announce: `Pasted ${plural(nodes.length, "node")}` } : added;
};

export const duplicateSelection = (state: NoteGraphState): NoteGraphEdit | null => {
  const clipboard = copySelection(state);
  if (!clipboard) return null;
  const edit = pasteClipboard(state, clipboard, null);
  return edit.graph
    ? { ...edit, announce: `Duplicated ${plural(clipboard.nodes.length, "node")}` }
    : edit;
};

/** Alt+drag: copies land where the drag ended and the originals stay where they were. */
export const duplicateNodesAt = (
  state: NoteGraphState,
  positions: ReadonlyMap<string, Point>,
): NoteGraphEdit | null => {
  const originals = state.graph.nodes.filter((node) => positions.has(node.id));
  if (originals.length === 0) return null;
  const ids = new Set(originals.map((node) => node.id));
  const copies = cloneNodes({
    nodes: originals,
    edges: state.graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
  });
  const placed = copies.nodes.map((copy, index) => {
    const position = positions.get(originals[index]!.id)!;
    return { ...copy, position: { x: Math.round(position.x), y: Math.round(position.y) } };
  });
  const added = addNodes(state.graph, placed, copies.edges);
  return added.graph
    ? { ...added, announce: `Duplicated ${plural(placed.length, "node")}` }
    : added;
};

/* ------------------------------------------------------------------------ */
/* Removing                                                                  */
/* ------------------------------------------------------------------------ */

const removeNodes = (
  graph: NoteGraph,
  nodeIds: ReadonlySet<string>,
  edgeIds = new Set<string>(),
) => ({
  ...graph,
  nodes: graph.nodes.filter((node) => !nodeIds.has(node.id)),
  edges: graph.edges.filter(
    (edge) => !edgeIds.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target),
  ),
});

/** Deletes the selection and its connectors. Locked nodes and connectors stay. */
export const deleteSelection = (state: NoteGraphState): NoteGraphEdit | null => {
  const picked = selectedNodes(state);
  const nodeIds = new Set(picked.filter((node) => !node.locked).map((node) => node.id));
  const edge = selectedEdge(state);
  const edgeIds = new Set(edge && !edge.locked ? [edge.id] : []);
  if (nodeIds.size === 0 && edgeIds.size === 0) return null;
  const removed = nodeIds.size + edgeIds.size;
  const keptLocked = picked.length - nodeIds.size + (edge?.locked ? 1 : 0);
  return {
    graph: removeNodes(state.graph, nodeIds, edgeIds),
    selection: emptyNoteGraphSelection,
    announce:
      keptLocked > 0
        ? `Deleted ${removed}; locked items kept`
        : `Deleted ${plural(removed, "item")}`,
  };
};

/** Removes a text object its writer left without text. */
export const removeEmptyText = (state: NoteGraphState, nodeId: string): NoteGraphEdit | null => {
  const node = state.graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.shape !== "text" || node.locked) return null;
  return {
    graph: removeNodes(state.graph, new Set([nodeId])),
    selection: emptyNoteGraphSelection,
  };
};

/** Removes a frame and keeps the nodes inside it. */
export const removeFrame = (state: NoteGraphState, frameId: string): NoteGraphEdit | null => {
  const frame = state.graph.nodes.find((node) => node.id === frameId);
  if (!frame || frame.locked) return null;
  return {
    graph: removeNodes(state.graph, new Set([frameId])),
    selection: emptyNoteGraphSelection,
    announce: "Frame removed",
  };
};

/* ------------------------------------------------------------------------ */
/* Changing nodes                                                            */
/* ------------------------------------------------------------------------ */

export const updateNode = (
  { graph }: NoteGraphState,
  nodeId: string,
  patch: Partial<NoteGraphNode>,
): NoteGraphEdit | null => {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  if (node.locked && !("locked" in patch)) return announceOnly("Node is locked");
  return {
    graph: replaceNodes(
      graph,
      graph.nodes.map((candidate) => (candidate.id === nodeId ? { ...node, ...patch } : candidate)),
    ),
  };
};

/** Applies one change to every selected, unlocked node. */
export const updateSelectedNodes = (
  state: NoteGraphState,
  patch: Partial<NoteGraphNode>,
): NoteGraphEdit | null => {
  const ids = new Set(
    selectedNodes(state)
      .filter((node) => !node.locked)
      .map((node) => node.id),
  );
  if (ids.size === 0) return null;
  return {
    graph: replaceNodes(
      state.graph,
      state.graph.nodes.map((node) => (ids.has(node.id) ? { ...node, ...patch } : node)),
    ),
  };
};

/**
 * Settles a resize. A collapsed frame shows only its title bar, so a resize gesture on one
 * puts the bar size back instead of storing geometry nobody sees.
 */
export const resizeNode = (
  state: NoteGraphState,
  nodeId: string,
  rect: { width: number; height: number; x?: number; y?: number },
): NoteGraphEdit | null => {
  const node = state.graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  if (isNoteGraphFrameNode(node) && node.collapsed) {
    return updateNode(state, nodeId, { size: resolveNoteGraphFrameBarSize(node) });
  }
  return updateNode(state, nodeId, {
    size: snapNoteGraphNodeSizeToGrid({ width: rect.width, height: rect.height }),
    ...(rect.x !== undefined && rect.y !== undefined ? { position: { x: rect.x, y: rect.y } } : {}),
  });
};

/** Ctrl/Cmd+arrow keys resize the single selected node in grid steps. */
export const resizeSelectionWithKeyboard = (
  state: NoteGraphState,
  direction: NoteGraphResizeDirection,
  step: number,
): NoteGraphEdit | null => {
  const targets = selectedNodes(state);
  const target = targets[0];
  if (targets.length !== 1 || !target || target.locked) return null;
  // A collapsed frame has no size to resize until it is expanded again.
  if (isNoteGraphFrameNode(target) && target.collapsed) return null;
  const current = getNoteGraphNodeSize(target);
  const size = getKeyboardResizedSize(current, direction, step);
  if (size.width === current.width && size.height === current.height) return null;
  return updateNode(state, target.id, { size });
};

export const moveNodes = (
  { graph }: NoteGraphState,
  positions: ReadonlyMap<string, Point>,
): NoteGraphEdit | null => {
  let moved = false;
  const nodes = graph.nodes.map((node) => {
    const position = positions.get(node.id);
    if (!position || (position.x === node.position.x && position.y === node.position.y)) {
      return node;
    }
    moved = true;
    return { ...node, position: { x: position.x, y: position.y } };
  });
  return moved ? { graph: replaceNodes(graph, nodes) } : null;
};

/** Arrow keys move the selected, unlocked nodes. */
export const nudgeSelection = (state: NoteGraphState, delta: Point): NoteGraphEdit | null => {
  const positions = new Map(
    selectedNodes(state)
      .filter((node) => !node.locked)
      .map((node) => [node.id, { x: node.position.x + delta.x, y: node.position.y + delta.y }]),
  );
  return moveNodes(state, positions);
};

export const toggleLockSelection = (state: NoteGraphState): NoteGraphEdit | null => {
  const nodes = selectedNodes(state);
  const edge = selectedEdge(state);
  if (nodes.length === 0 && !edge) return null;
  const locking = nodes.some((node) => !node.locked) || Boolean(edge && !edge.locked);
  const locked = locking ? true : undefined;
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    graph: {
      ...state.graph,
      nodes: state.graph.nodes.map((node) => (nodeIds.has(node.id) ? { ...node, locked } : node)),
      edges: state.graph.edges.map((candidate) =>
        candidate.id === edge?.id ? { ...candidate, locked } : candidate,
      ),
    },
    announce: locking ? "Locked" : "Unlocked",
  };
};

export type NoteGraphReorder = "forward" | "backward" | "front" | "back";

const reorderGroup = (group: NoteGraphNode[], ids: ReadonlySet<string>, mode: NoteGraphReorder) => {
  if (!group.some((node) => ids.has(node.id))) return group;
  if (mode === "front" || mode === "back") {
    const picked = group.filter((node) => ids.has(node.id));
    const rest = group.filter((node) => !ids.has(node.id));
    return mode === "front" ? [...rest, ...picked] : [...picked, ...rest];
  }
  const result = [...group];
  const swap = (from: number, to: number) => {
    const [item] = result.splice(from, 1);
    result.splice(to, 0, item!);
  };
  if (mode === "forward") {
    for (let i = result.length - 2; i >= 0; i -= 1) {
      if (ids.has(result[i]!.id) && !ids.has(result[i + 1]!.id)) swap(i, i + 1);
    }
  } else {
    for (let i = 1; i < result.length; i += 1) {
      if (ids.has(result[i]!.id) && !ids.has(result[i - 1]!.id)) swap(i, i - 1);
    }
  }
  return result;
};

/** Changes the drawing order. Frames always stay below other nodes. */
export const reorderSelection = (
  state: NoteGraphState,
  mode: NoteGraphReorder,
): NoteGraphEdit | null => {
  const ids = new Set(selectedNodes(state).map((node) => node.id));
  if (ids.size === 0) return null;
  const frames = state.graph.nodes.filter(isNoteGraphFrameNode);
  const others = state.graph.nodes.filter((node) => !isNoteGraphFrameNode(node));
  return {
    graph: replaceNodes(state.graph, [
      ...reorderGroup(frames, ids, mode),
      ...reorderGroup(others, ids, mode),
    ]),
    announce: noteGraphReorderOptions.find((option) => option.id === mode)?.done,
  };
};

/* ------------------------------------------------------------------------ */
/* Frames                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Collapsing hides the frame's members and their connectors, and drops them from the
 * selection: nothing should act on nodes the canvas does not draw.
 */
export const toggleFrameCollapsed = (
  state: NoteGraphState,
  frameId: string,
): NoteGraphEdit | null => {
  const frame = state.graph.nodes.find((node) => node.id === frameId);
  if (!frame || !isNoteGraphFrameNode(frame)) return null;
  const collapsing = !frame.collapsed;
  const next: NoteGraphNode = collapsing
    ? {
        ...frame,
        collapsed: true,
        expandedSize: getNoteGraphNodeSize(frame),
        size: resolveNoteGraphFrameBarSize(frame),
      }
    : {
        ...frame,
        collapsed: undefined,
        size: frame.expandedSize ?? { ...noteGraphFrameDefaultSize },
        expandedSize: undefined,
      };
  const graph = replaceNodes(
    state.graph,
    state.graph.nodes.map((node) => (node.id === frameId ? next : node)),
  );
  const hidden = findCollapsedFrameHiddenNodeIds(graph.nodes);
  const edge = selectedEdge(state);
  return {
    graph,
    selection: {
      nodeIds: state.selection.nodeIds.filter((id) => !hidden.has(id)),
      edgeId: edge && !hidden.has(edge.source) && !hidden.has(edge.target) ? edge.id : null,
    },
    announce: collapsing ? "Frame collapsed" : "Frame expanded",
  };
};

/** Wraps the selection in a new frame. */
export const frameSelection = (state: NoteGraphState): NoteGraphEdit | null => {
  const nodes = selectedNodes(state);
  if (nodes.length === 0) return null;
  const bounds = getNoteGraphBounds(nodes, 40);
  return addNode(state, {
    shape: "frame",
    position: bounds,
    patch: { size: { width: bounds.width, height: bounds.height } },
  });
};

export const fitFrameToContents = (
  state: NoteGraphState,
  frameId: string,
): NoteGraphEdit | null => {
  const frame = state.graph.nodes.find((node) => node.id === frameId);
  if (!frame) return null;
  const members = new Set(findNoteGraphFrameMemberIds(state.graph.nodes, frame));
  if (members.size === 0) return null;
  const bounds = getNoteGraphBounds(
    state.graph.nodes.filter((node) => members.has(node.id)),
    40,
  );
  return updateNode(state, frameId, {
    position: { x: bounds.x, y: bounds.y },
    size: { width: bounds.width, height: bounds.height },
    collapsed: undefined,
    expandedSize: undefined,
  });
};

/** Selects a frame's members, expanding the frame first so they are visible. */
export const selectFrameContents = (
  state: NoteGraphState,
  frameId: string,
): NoteGraphEdit | null => {
  const frame = state.graph.nodes.find((node) => node.id === frameId);
  if (!frame) return null;
  const expanded = frame.collapsed ? toggleFrameCollapsed(state, frameId) : null;
  const graph = expanded?.graph ?? state.graph;
  return {
    graph: expanded?.graph,
    selection: selectNodes(findNoteGraphFrameMemberIds(graph.nodes, frame)),
  };
};

/* ------------------------------------------------------------------------ */
/* Connectors                                                                */
/* ------------------------------------------------------------------------ */

export const connectNodes = (
  { graph }: NoteGraphState,
  sourceId: string,
  targetId: string,
): NoteGraphEdit | null => {
  if (sourceId === targetId) return null;
  const candidate: NoteGraphEdge = { id: createUuid(), source: sourceId, target: targetId };
  const edges = normalizeNoteGraphEdges([...graph.edges, candidate], graph.nodes);
  if (!edges.some((edge) => edge.id === candidate.id)) return announceOnly("Already connected");
  return { graph: { ...graph, edges }, announce: "Connected" };
};

/**
 * Changes a connector. A new source or target goes through the same normalization saving
 * does, so a change that would duplicate another connector is refused instead of silently
 * dropping one of the pair on save.
 */
export const updateEdge = (
  { graph }: NoteGraphState,
  edgeId: string,
  patch: Partial<NoteGraphEdge>,
): NoteGraphEdit | null => {
  const edge = graph.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) return null;
  if (edge.locked && !("locked" in patch)) return announceOnly("Connector is locked");
  const edges = normalizeNoteGraphEdges(
    graph.edges.map((candidate) => (candidate.id === edgeId ? { ...edge, ...patch } : candidate)),
    graph.nodes,
  );
  if (edges.length < normalizeNoteGraphEdges(graph.edges, graph.nodes).length) {
    return announceOnly("Already connected");
  }
  return { graph: { ...graph, edges } };
};

export const reverseEdge = (state: NoteGraphState, edgeId: string): NoteGraphEdit | null => {
  const edge = state.graph.edges.find((candidate) => candidate.id === edgeId);
  return edge ? updateEdge(state, edgeId, { source: edge.target, target: edge.source }) : null;
};

/** Chains the timestamped nodes in playback order with dashed connectors. */
export const connectPlaybackOrder = ({ graph }: NoteGraphState): NoteGraphEdit | null => {
  const chain = buildNoteGraphPlaybackEdges(graph.nodes);
  if (chain.length === 0) return null;
  const edges = normalizeNoteGraphEdges([...graph.edges, ...chain], graph.nodes);
  if (edges.length === graph.edges.length) {
    return announceOnly("Playback order already connected");
  }
  return { graph: { ...graph, edges }, announce: "Playback order connected" };
};

/* ------------------------------------------------------------------------ */
/* Layout and color                                                          */
/* ------------------------------------------------------------------------ */

/**
 * Moves nodes to computed positions, then pushes apart anything left overlapping. Locked
 * nodes stay where they are, as they do for every other edit. The canvas and AI clients
 * both lay out graphs through here.
 */
export const applyLayout = (
  { graph }: NoteGraphState,
  positions: NoteGraphPositions,
  label: string,
): NoteGraphEdit => {
  let moved = false;
  const moveTo = (node: NoteGraphNode, next: Point | undefined) => {
    if (
      !next ||
      node.locked ||
      (Math.round(node.position.x) === next.x && Math.round(node.position.y) === next.y)
    ) {
      return node;
    }
    moved = true;
    return { ...node, position: next };
  };
  const laidOut = graph.nodes.map((node) => moveTo(node, positions[node.id]));
  if (!moved) return announceOnly("Layout already clean");
  const repaired = repairNoteGraphOverlaps(laidOut);
  const nodes = laidOut.map((node) => moveTo(node, repaired[node.id]));
  const next = replaceNodes(graph, nodes);
  return { graph: next, announce: `${label}: ${formatNoteGraphSummary(next)}` };
};

/** Lays out the selected nodes as a tidy tree, keeping their top-left corner. */
export const tidySelection = (state: NoteGraphState): NoteGraphEdit | null => {
  const nodes = selectedNodes(state);
  if (nodes.length < 2) return null;
  const ids = new Set(nodes.map((node) => node.id));
  const positions = computeNoteGraphTidyLayout({
    nodes,
    edges: state.graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
  });
  const values = Object.values(positions);
  if (values.length === 0) return null;
  const layoutLeft = Math.min(...values.map((position) => position.x));
  const layoutTop = Math.min(...values.map((position) => position.y));
  const left = Math.min(...nodes.map((node) => node.position.x));
  const top = Math.min(...nodes.map((node) => node.position.y));
  const translated = Object.fromEntries(
    Object.entries(positions).map(([id, position]) => [
      id,
      { x: position.x - layoutLeft + left, y: position.y - layoutTop + top },
    ]),
  );
  return applyLayout(state, translated, "Tidied selection");
};

export const alignSelection = (
  state: NoteGraphState,
  mode: NoteGraphAlignMode,
): NoteGraphEdit | null => {
  const ids = new Set(selectedNodes(state).map((node) => node.id));
  if (ids.size < 2) return null;
  return applyLayout(state, alignNoteGraphNodes(state.graph.nodes, ids, mode), "Aligned");
};

export const distributeSelection = (
  state: NoteGraphState,
  axis: NoteGraphDistributeAxis,
): NoteGraphEdit | null => {
  const ids = new Set(selectedNodes(state).map((node) => node.id));
  if (ids.size < 3) return null;
  return applyLayout(state, distributeNoteGraphNodes(state.graph.nodes, ids, axis), "Distributed");
};

export const applyTimelineLayout = (state: NoteGraphState) =>
  applyLayout(state, computeNoteGraphTimelineLayout(state.graph.nodes), "Timeline layout");

/** Gives each connected cluster its own color. Locked nodes keep theirs. */
export const colorByCluster = ({ graph }: NoteGraphState): NoteGraphEdit => {
  const colors = resolveNoteGraphClusterColors(graph.nodes, graph.edges);
  return {
    graph: replaceNodes(
      graph,
      graph.nodes.map((node) =>
        node.locked ? node : { ...node, color: colors[node.id], colorHex: undefined },
      ),
    ),
    announce: "Colored by cluster",
  };
};

const linkedHeading = (
  { graph }: NoteGraphState,
  nodeId: string,
  headingOptions: readonly NoteHeadingConnectionOption[],
) => {
  const headingId = graph.nodes.find((node) => node.id === nodeId)?.headingBlockIds?.[0];
  return headingId
    ? headingOptions.find((option) => option.headingBlockId === headingId)
    : undefined;
};

export const syncTitleFromHeading = (
  state: NoteGraphState,
  nodeId: string,
  headingOptions: readonly NoteHeadingConnectionOption[],
): NoteGraphEdit | null => {
  const heading = linkedHeading(state, nodeId, headingOptions);
  if (!heading) return null;
  const edit = updateNode(state, nodeId, { title: heading.title });
  return edit?.graph ? { ...edit, announce: "Title synced from heading" } : edit;
};

/** Colors a node after the page tab its first linked heading lives in. */
export const matchHeadingColor = (
  state: NoteGraphState,
  nodeId: string,
  headingOptions: readonly NoteHeadingConnectionOption[],
): NoteGraphEdit | null => {
  const heading = linkedHeading(state, nodeId, headingOptions);
  if (!heading) return null;
  let hash = 0;
  for (const char of heading.tabId) hash = (hash + char.charCodeAt(0)) % 997;
  const edit = updateNode(state, nodeId, {
    color: noteGraphNodeColors[hash % noteGraphNodeColors.length],
    colorHex: undefined,
  });
  return edit?.graph ? { ...edit, announce: "Color matched to heading tab" } : edit;
};

/* ------------------------------------------------------------------------ */
/* Selection                                                                 */
/* ------------------------------------------------------------------------ */

/** Selects every drawn node, keeping the current primary first. */
export const selectAll = (state: NoteGraphState): NoteGraphEdit | null => {
  const hidden = findCollapsedFrameHiddenNodeIds(state.graph.nodes);
  const visible = state.graph.nodes.filter((node) => !hidden.has(node.id)).map((node) => node.id);
  if (visible.length === 0) return null;
  const primary = state.selection.nodeIds[0];
  const nodeIds =
    primary && visible.includes(primary)
      ? [primary, ...visible.filter((id) => id !== primary)]
      : visible;
  return { selection: selectNodes(nodeIds) };
};

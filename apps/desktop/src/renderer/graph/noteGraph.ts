/** Creating and tidying note graphs: new nodes and graphs, duplicates, connector rules. */
import { incrementDuplicateName } from "../lib/duplicateName";
import { createUuid } from "@loam/shared/utils/uuid";
import {
  noteGraphNodeDefaultSize,
  noteGraphImageNodeDefaultSize,
} from "@loam/shared/notes/noteGraphGeometry";
import { noteGraphFrameDefaultSize } from "./noteGraphFrames";
import { noteGraphTextNodeDefaultSize } from "./noteGraphGeometry";
import type { NoteDocument } from "../workspace/types";
import type {
  NoteGraph,
  NoteGraphEdge,
  NoteGraphNode,
  NoteGraphNodeShape,
  NoteGraphNodeSize,
} from "@loam/shared/notes/noteModel";

type NewNodeDefaults = Pick<NoteGraphNode, "title" | "notes" | "color"> & {
  size: NoteGraphNodeSize;
};

const cardDefaults: NewNodeDefaults = {
  title: "New node",
  notes: "",
  color: "blue",
  size: noteGraphNodeDefaultSize,
};

/** What a new node of each shape starts as. */
const newNodeDefaults: Record<NoteGraphNodeShape, NewNodeDefaults> = {
  process: cardDefaults,
  terminator: cardDefaults,
  decision: cardDefaults,
  ellipse: cardDefaults,
  sticky: cardDefaults,
  text: { title: "Text", notes: "", color: "gray", size: noteGraphTextNodeDefaultSize },
  image: { title: "Image", color: "blue", size: noteGraphImageNodeDefaultSize },
  frame: { title: "Group", color: "gray", size: noteGraphFrameDefaultSize },
};

export const createNoteGraphNode = (
  shape: NoteGraphNodeShape,
  position: { x: number; y: number },
): NoteGraphNode => {
  const { size, ...defaults } = newNodeDefaults[shape];
  return { id: createUuid(), ...defaults, shape, size: { ...size }, position };
};

/** A new graph starts with one node named after its note. */
export const createNoteGraph = (note: Pick<NoteDocument, "title">): NoteGraph => ({
  enabled: true,
  nodes: [
    {
      ...createNoteGraphNode("process", { x: 80, y: 80 }),
      title: note.title.trim() || "Start here",
      notes: "Add the first concept.",
      color: "green",
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 0.85 },
});

/** How the canvas looks and scrolls. A graph stores only the ones the user changed. */
export type NoteGraphViewPreferences = {
  grid: NonNullable<NoteGraph["grid"]>;
  snap: boolean;
  scrollMode: NonNullable<NoteGraph["scrollMode"]>;
  theme: NonNullable<NoteGraph["theme"]>;
};

/** A graph's view preferences, with the defaults for the ones it does not store. */
export const resolveNoteGraphViewPreferences = (
  graph: Pick<NoteGraph, "grid" | "snap" | "scrollMode" | "theme">,
): NoteGraphViewPreferences => ({
  grid: graph.grid ?? "dots",
  snap: graph.snap ?? true,
  scrollMode: graph.scrollMode ?? "zoom",
  theme: graph.theme ?? "default",
});

export const duplicateNoteGraphNode = (node: NoteGraphNode, id = createUuid()): NoteGraphNode => ({
  ...node,
  id,
  title: incrementDuplicateName(node.title),
  headingBlockIds: node.headingBlockIds ? [...node.headingBlockIds] : undefined,
  position: {
    x: node.position.x + 32,
    y: node.position.y + 32,
  },
});

export const normalizeNoteGraphEdges = (edges: NoteGraphEdge[], nodes: NoteGraphNode[]) => {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const seen = new Set<string>();
  return edges.filter((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target) {
      return false;
    }
    const identity = `${edge.source}:${edge.target}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};

import type {
  NoteGraphEdgeDirection,
  NoteGraphEdgeType,
  NoteGraphNodeColor,
} from "@loam/shared/notes/noteModel";

/** Connector styles in the order Shift+click cycles through them. */
export const noteGraphEdgeTypes: NoteGraphEdgeType[] = ["smoothstep", "bezier", "straight", "step"];

export const cycleNoteGraphEdgeType = (type?: NoteGraphEdgeType): NoteGraphEdgeType => {
  const index = noteGraphEdgeTypes.indexOf(type ?? "smoothstep");
  return noteGraphEdgeTypes[(index + 1) % noteGraphEdgeTypes.length]!;
};

export const noteGraphEdgeDirections: Array<{
  id: NoteGraphEdgeDirection;
  label: string;
}> = [
  { id: "end", label: "Forward arrow" },
  { id: "start", label: "Backward arrow" },
  { id: "both", label: "Both arrows" },
  { id: "none", label: "No arrows" },
];

/** Typed relation presets: label + color + dash, applied in one click. */
export const noteGraphEdgeRelations: Array<{
  id: string;
  label: string;
  color: NoteGraphNodeColor;
  dashed: boolean;
}> = [
  { id: "causes", label: "causes", color: "green", dashed: false },
  { id: "supports", label: "supports", color: "blue", dashed: false },
  { id: "contradicts", label: "contradicts", color: "red", dashed: true },
  { id: "example", label: "example of", color: "purple", dashed: true },
];

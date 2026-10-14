import type { NoteGraphNode, NoteGraphNodeColor } from "./noteModel";

export const noteGraphNodeColors = [
  "blue",
  "green",
  "purple",
  "orange",
  "red",
  "yellow",
  "pink",
  "gray",
] as const satisfies readonly NoteGraphNodeColor[];

export const noteGraphColorHex: Record<NoteGraphNodeColor, string> = {
  blue: "#0ea5e9",
  green: "#10b981",
  purple: "#8b5cf6",
  orange: "#f59e0b",
  red: "#f43f5e",
  yellow: "#eab308",
  pink: "#ec4899",
  gray: "#64748b",
};

/** A custom node colour: #rgb or #rrggbb. */
export const isNoteGraphHexColor = (value: string): boolean =>
  /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);

export const resolveNoteGraphNodeHex = (
  node: Pick<NoteGraphNode, "color" | "colorHex">,
): string => {
  const custom = node.colorHex?.trim();
  if (custom && isNoteGraphHexColor(custom)) {
    return custom;
  }
  return noteGraphColorHex[node.color ?? "blue"];
};

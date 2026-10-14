import type { NoteGraphNode, NoteGraphNodeShape, NoteGraphNodeSize } from "./noteModel";

export const noteGraphNodeDefaultSize = {
  width: 224,
  height: 84,
} as const;

export const noteGraphNodeSizeLimits = {
  minWidth: 96,
  maxWidth: 720,
  minHeight: 48,
  // Grid-aligned (32 * 16) so snapped resizes can always reach the max.
  maxHeight: 512,
} as const;

export const clampNoteGraphNodeSize = (size: NoteGraphNodeSize): NoteGraphNodeSize => ({
  width: Math.min(
    noteGraphNodeSizeLimits.maxWidth,
    Math.max(noteGraphNodeSizeLimits.minWidth, Math.round(size.width)),
  ),
  height: Math.min(
    noteGraphNodeSizeLimits.maxHeight,
    Math.max(noteGraphNodeSizeLimits.minHeight, Math.round(size.height)),
  ),
});

// Approximate glyph metrics of the node card fonts (12px semibold title,
// 10.5px notes) so generated nodes can be sized before they are measured.
const titleCharWidth = 6.4;

const notesCharWidth = 5.4;

const titleLineHeight = 16;

const notesLineHeight = 14;

const maxNotesLines = 8;

export const estimateNoteGraphNodeSize = (input: {
  title: string;
  notes?: string | null;
  shape?: NoteGraphNodeShape | null;
  timestampSeconds?: number | null;
}): NoteGraphNodeSize => {
  const shape = input.shape ?? "process";
  let paddingX = 24;
  let paddingY = 20;
  if (shape === "decision") {
    paddingX = 80;
    paddingY = 48;
  } else if (shape === "text") {
    paddingX = 8;
    paddingY = 8;
  }
  const wrapLines = (text: string, charWidth: number, width: number) => {
    const charsPerLine = Math.max(8, Math.floor((width - paddingX) / charWidth));
    return text
      .split("\n")
      .reduce((lines, segment) => lines + Math.max(1, Math.ceil(segment.length / charsPerLine)), 0);
  };
  const measureHeight = (width: number) => {
    const titleLines = Math.min(
      5,
      wrapLines(input.title.trim() || "Untitled node", titleCharWidth, width),
    );
    const notesText = input.notes?.trim() ?? "";
    const notesLines = notesText
      ? Math.min(maxNotesLines, wrapLines(notesText, notesCharWidth, width))
      : 0;
    let height = paddingY + titleLines * titleLineHeight;
    if (notesLines > 0) height += 6 + notesLines * notesLineHeight;
    if (typeof input.timestampSeconds === "number") height += 28;
    // Rounded and clipped shapes lose usable corners, so give them extra room.
    if (shape === "decision") height *= 1.25;
    else if (shape === "terminator" || shape === "ellipse") height *= 1.12;
    return height;
  };
  let width: number = noteGraphNodeDefaultSize.width;
  let height = measureHeight(width);
  // Prefer a wider node over a very tall one when there is a lot of text.
  if (height > 176) {
    const widerWidth = Math.min(360, width + 136);
    const widerHeight = measureHeight(widerWidth);
    if (widerHeight < height) {
      width = widerWidth;
      height = widerHeight;
    }
  }
  return clampNoteGraphNodeSize({
    width,
    height: Math.max(noteGraphNodeDefaultSize.height, height),
  });
};

export const noteGraphImageNodeDefaultSize = {
  width: 240,
  height: 176,
} as const;

export const getNoteGraphNodeSize = (node: Pick<NoteGraphNode, "size">): NoteGraphNodeSize =>
  node.size ?? noteGraphNodeDefaultSize;

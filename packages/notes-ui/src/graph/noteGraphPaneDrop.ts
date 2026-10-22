import { isSupportedImageFile } from "../media/imageFileTypes";

import { noteGraphShapeOptions } from "./noteGraphShapes";
import type { NoteGraphNodeShape } from "@loam/shared/notes/noteModel";

/** The drag data type the toolbar sets to the shape a drag carries onto the canvas. */
export const noteGraphShapeDragType = "application/x-note-graph-shape";

type NoteGraphPaneDropDecision =
  | { type: "ignore" }
  | { type: "image-on-node"; file: File; nodeId: string }
  | { type: "images-on-canvas"; files: File[]; position: { x: number; y: number } }
  | { type: "create-node"; shape: NoteGraphNodeShape; position: { x: number; y: number } };

export const resolveNoteGraphPaneDrop = ({
  clientX,
  clientY,
  files,
  hasNode,
  readOnly,
  screenToFlowPosition,
  shapeData,
  targetNodeId,
}: {
  clientX: number;
  clientY: number;
  files: readonly File[];
  hasNode: (nodeId: string) => boolean;
  readOnly: boolean;
  screenToFlowPosition: (point: { x: number; y: number }) => { x: number; y: number } | null;
  shapeData: string;
  targetNodeId: string | null;
}): NoteGraphPaneDropDecision => {
  if (!readOnly) {
    const imageFiles = files.filter(isSupportedImageFile);
    if (imageFiles.length > 0) {
      if (targetNodeId && hasNode(targetNodeId)) {
        return { type: "image-on-node", file: imageFiles[0]!, nodeId: targetNodeId };
      }
      const position = screenToFlowPosition({ x: clientX, y: clientY }) ?? { x: 120, y: 120 };
      return { type: "images-on-canvas", files: imageFiles, position };
    }
  }

  // The toolbar's image button drags "image", which is not one of the shape options.
  const shape =
    shapeData === "image"
      ? "image"
      : noteGraphShapeOptions.find((option) => option.id === shapeData)?.id;
  const position = screenToFlowPosition({ x: clientX, y: clientY });
  if (!position || !shape) return { type: "ignore" };
  return { type: "create-node", shape, position };
};

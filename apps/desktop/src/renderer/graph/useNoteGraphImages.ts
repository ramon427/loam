import { useCallback, useRef, type ChangeEvent, type ClipboardEvent, type RefObject } from "react";

import { isEditableTarget } from "../keyboard/shortcuts";
import { useImageUpload } from "../media/useImageUpload";
import { isSupportedImageFile } from "../media/imageFileTypes";
import { noteGraphImageNodeDefaultSize } from "@loam/shared/notes/noteGraphGeometry";
import type { NoteGraph, NoteGraphNode } from "@loam/shared/notes/noteModel";

type Point = { x: number; y: number };

/**
 * Image nodes: uploads from the file picker, dropped files and pasted images.
 */
export function useNoteGraphImages({
  fileInputRef,
  readOnly,
  getGraph,
  updateNode,
  addNodeAt,
  addNodeInCenter,
  pastePosition,
  pasteNodes,
  announce,
}: {
  /** The canvas's hidden file input, which opens the image picker. */
  fileInputRef: RefObject<HTMLInputElement | null>;
  readOnly: boolean;
  getGraph: () => NoteGraph;
  updateNode: (nodeId: string, patch: Partial<NoteGraphNode>) => void;
  /** Returns the new node's id, or null when it could not be added. */
  addNodeAt: (shape: "image", position: Point, patch?: Partial<NoteGraphNode>) => string | null;
  addNodeInCenter: (shape: "image") => string | null;
  /** Where a pasted image lands: the last pointer position on the canvas, or its centre. */
  pastePosition: () => Point;
  /** Pastes nodes copied on the canvas; returns whether there were any. */
  pasteNodes: () => boolean;
  announce: (message: string) => void;
}) {
  const { uploadImage } = useImageUpload();
  const uploadTargetRef = useRef<string | null>(null);

  const requestImageUpload = useCallback(
    (nodeId: string) => {
      if (readOnly) return;
      uploadTargetRef.current = nodeId;
      fileInputRef.current?.click();
    },
    [fileInputRef, readOnly],
  );

  const uploadImageForNode = useCallback(
    async (file: File, nodeId: string) => {
      const result = await uploadImage(file);
      if (!result?.path) return;
      const node = getGraph().nodes.find((candidate) => candidate.id === nodeId);
      updateNode(nodeId, {
        imageUrl: result.path,
        shape: "image",
        size: node?.size ?? { ...noteGraphImageNodeDefaultSize },
      });
    },
    [getGraph, updateNode, uploadImage],
  );

  const uploadImageForNewNode = useCallback(
    async (file: File, position: Point) => {
      const result = await uploadImage(file);
      if (!result?.path || readOnly) return;
      addNodeAt("image", position, { imageUrl: result.path });
    },
    [addNodeAt, readOnly, uploadImage],
  );

  const handleImageFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset so picking the same file twice still fires change.
      event.target.value = "";
      const nodeId = uploadTargetRef.current;
      uploadTargetRef.current = null;
      if (file && nodeId) void uploadImageForNode(file, nodeId);
    },
    [uploadImageForNode],
  );

  const addImageNode = useCallback(() => {
    const nodeId = addNodeInCenter("image");
    if (nodeId) requestImageUpload(nodeId);
  }, [addNodeInCenter, requestImageUpload]);

  /**
   * Ctrl/Cmd+V (or Paste from the app menu) on the canvas: an image on the system clipboard
   * becomes an image node; otherwise nodes copied on the canvas are pasted.
   */
  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (readOnly || isEditableTarget(event.target)) return;
      const file = Array.from(event.clipboardData.files).find(isSupportedImageFile);
      if (file) {
        event.preventDefault();
        void uploadImageForNewNode(file, pastePosition());
        announce("Pasting image");
        return;
      }
      if (pasteNodes()) event.preventDefault();
    },
    [announce, pasteNodes, pastePosition, readOnly, uploadImageForNewNode],
  );

  return {
    requestImageUpload,
    uploadImageForNode,
    uploadImageForNewNode,
    handleImageFileChange,
    addImageNode,
    handlePaste,
  };
}

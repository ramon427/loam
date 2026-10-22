import { useCallback } from "react";

import { buildNoteGraphJsonCanvas } from "@loam/transfer/canvas/noteGraphJsonCanvas";

import { canvasToPngBlob, downloadBlob, renderNoteGraphImage } from "./noteGraphImage";
import { insertNodeSet, type NoteGraphEdit, type NoteGraphState } from "./noteGraphOps";
import { buildNoteGraphSvg } from "./noteGraphSvg";
import { noteGraphTemplates } from "./noteGraphTemplates";
import type { NoteGraph } from "@loam/shared/notes/noteModel";
import { errorMessage } from "../lib/errorMessage";

type GraphParts = Pick<NoteGraph, "nodes" | "edges">;

/** Templates, imports and exports. Inserted nodes are framed in view once they render. */
export function useNoteGraphTransfer({
  getGraph,
  run,
  announce,
  revealNodes,
}: {
  getGraph: () => NoteGraph;
  run: (operation: (state: NoteGraphState) => NoteGraphEdit | null) => NoteGraphEdit | null;
  announce: (message: string) => void;
  revealNodes: (nodeIds: readonly string[]) => void;
}) {
  const insert = useCallback(
    (parts: GraphParts, label: string) => {
      const edit = run((state) => insertNodeSet(state, parts, label));
      if (edit?.addedNodeIds) revealNodes(edit.addedNodeIds);
    },
    [revealNodes, run],
  );

  const insertTemplate = useCallback(
    (templateId: string) => {
      const template = noteGraphTemplates.find((entry) => entry.id === templateId);
      if (template) insert(template.build(), `Inserted template: ${template.label}`);
    },
    [insert],
  );

  const insertImport = useCallback(
    (parts: GraphParts) =>
      insert(
        parts,
        `Imported ${parts.nodes.length} nodes${parts.edges.length > 0 ? ` and ${parts.edges.length} connectors` : ""}`,
      ),
    [insert],
  );

  const exportSvgFile = useCallback(() => {
    downloadBlob(
      "note-graph.svg",
      new Blob([buildNoteGraphSvg(getGraph())], { type: "image/svg+xml" }),
    );
    announce("SVG downloaded");
  }, [announce, getGraph]);

  const exportJsonCanvasFile = useCallback(() => {
    downloadBlob(
      "note-graph.canvas",
      new Blob([buildNoteGraphJsonCanvas(getGraph())], { type: "application/json" }),
    );
    announce("JSON Canvas downloaded");
  }, [announce, getGraph]);

  /** Draws the PNG, or announces why it could not. */
  const renderPng = useCallback(async () => {
    try {
      return await canvasToPngBlob(await renderNoteGraphImage(getGraph()));
    } catch (error) {
      announce(errorMessage(error, "The image could not be created."));
      return null;
    }
  }, [announce, getGraph]);

  const exportPngFile = useCallback(async () => {
    const blob = await renderPng();
    if (!blob) return;
    downloadBlob("note-graph.png", blob);
    announce("PNG downloaded");
  }, [announce, renderPng]);

  const copyPngImage = useCallback(async () => {
    const blob = await renderPng();
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      announce("Image copied to clipboard");
    } catch {
      downloadBlob("note-graph.png", blob);
      announce("Clipboard blocked: downloaded instead");
    }
  }, [announce, renderPng]);

  return {
    insertTemplate,
    insertImport,
    exportSvgFile,
    exportJsonCanvasFile,
    exportPngFile,
    copyPngImage,
  };
}

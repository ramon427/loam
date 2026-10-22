import { useState, type RefObject } from "react";

import { Button } from "../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../ui/Dialog";
import { Textarea } from "../ui/Textarea";

import { readNoteGraphImport, type NoteGraphImportFormat } from "./noteGraphImport";
import type { NoteGraph } from "@loam/shared/notes/noteModel";

type GraphParts = Pick<NoteGraph, "nodes" | "edges">;

const copy: Record<NoteGraphImportFormat, { title: string; hint: string; placeholder: string }> = {
  mermaid: {
    title: "Import Mermaid flowchart",
    hint: "Paste flowchart lines like A[Setup] --> B[Entry]. Nodes are placed on a starter grid.",
    placeholder: "flowchart LR\n  A[Setup] --> B[Entry]",
  },
  jsoncanvas: {
    title: "Import JSON Canvas",
    hint: "Paste the contents of a .canvas file. Text cards become nodes, groups become frames.",
    placeholder: '{ "nodes": [], "edges": [] }',
  },
};

/** Paste Mermaid or JSON Canvas text; invalid input is explained before anything is added. */
export function NoteGraphImportDialog({
  format,
  getGraph,
  onImport,
  onClose,
  returnFocusRef,
}: {
  format: NoteGraphImportFormat;
  /** The graph the import joins, which it is validated together with. */
  getGraph: () => GraphParts;
  onImport: (parts: GraphParts) => void;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { title, hint, placeholder } = copy[format];
  const submit = () => {
    const result = readNoteGraphImport(format, text, getGraph());
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onImport(result.parts);
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-w-lg gap-0 overflow-hidden"
        onCloseAutoFocus={(event) => {
          // The menu item that opened the dialog is gone; return to the toolbar button.
          if (returnFocusRef.current?.isConnected) {
            event.preventDefault();
            returnFocusRef.current.focus();
          }
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="mt-2">{hint}</DialogDescription>
        <Textarea
          className="mt-3 min-h-40 font-mono text-xs"
          onChange={(event) => setText(event.target.value)}
          placeholder={placeholder}
          value={text}
        />
        {error ? (
          <p className="mt-2 select-text text-xs font-medium text-(--status-danger)" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter className="mt-4">
          <Button onClick={onClose} size="sm" variant="secondary">
            Cancel
          </Button>
          <Button disabled={!text.trim()} onClick={submit} size="sm">
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

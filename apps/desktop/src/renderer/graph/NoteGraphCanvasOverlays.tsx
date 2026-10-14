import type { ReactNode } from "react";
import { XIcon, FocusIcon, MaximizeIcon, MinusIcon, PlusIcon } from "lucide-react";

import { cn } from "../ui/cn";
import { Button } from "../ui/Button";
import { resolveNoteGraphNodeHex } from "@loam/shared/notes/noteGraphColors";
import { MAX_NOTE_GRAPH_NODES } from "@loam/shared/notes/noteGraphSchema";

import type { NoteGraphNode } from "@loam/shared/notes/noteModel";

const chipClass =
  "rounded-md border border-(--app-border)/80 bg-(--app-page)/96 px-3 py-1.5 text-xs font-medium text-(--app-text) shadow-lg backdrop-blur";

/** Loops and the node limit, shown only while they apply. */
export function NoteGraphWarnings({
  nodeCount,
  loopCount,
}: {
  nodeCount: number;
  loopCount: number;
}) {
  const nearLimit = nodeCount >= MAX_NOTE_GRAPH_NODES - 10;
  if (loopCount === 0 && !nearLimit) return null;
  return (
    <div className="absolute bottom-14 left-3 z-20 flex items-center gap-2 rounded-md border border-amber-500/40 bg-(--app-page)/95 px-2 py-1 text-[10px] font-medium tabular-nums text-amber-600 shadow-sm backdrop-blur dark:text-amber-400">
      {loopCount > 0 ? (
        <span title="This graph contains loops (circular connectors)">
          {loopCount === 1 ? "1 loop" : `${loopCount} loops`}
        </span>
      ) : null}
      {nearLimit ? <span>approaching {MAX_NOTE_GRAPH_NODES}-node limit</span> : null}
    </div>
  );
}

/** A short notice floating over the canvas. */
export function NoteGraphChip({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div className={cn("absolute left-1/2 z-30 -translate-x-1/2", chipClass, className)}>
      {children}
    </div>
  );
}

/** Bottom-centre notices and bars, stacked upwards so they never overlap. */
export function NoteGraphBottomStack({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 flex-col-reverse items-center gap-2 [&>*]:pointer-events-auto">
      {children}
    </div>
  );
}

/** What the last action did, for screen readers and as a brief visible notice. */
export function NoteGraphStatus({ message }: { message: string | null }) {
  return (
    <>
      <div aria-live="polite" className="sr-only" role="status">
        {message}
      </div>
      {message ? <div className={chipClass}>{message}</div> : null}
    </>
  );
}

export function NoteGraphZoomControls({
  zoomPct,
  canZoomToSelection,
  onZoomIn,
  onZoomOut,
  onZoomTo100,
  onFitView,
  onZoomToSelection,
}: {
  zoomPct: number;
  canZoomToSelection: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomTo100: () => void;
  onFitView: () => void;
  onZoomToSelection: () => void;
}) {
  return (
    <div
      aria-label="Note graph zoom controls"
      className="absolute bottom-3 left-3 z-20 flex items-center gap-0.5 rounded-md border border-(--app-border)/70 bg-(--app-page)/95 px-1 py-1 shadow-sm backdrop-blur"
      role="toolbar"
    >
      <Button
        aria-label="Zoom out"
        onClick={onZoomOut}
        size="icon-xs"
        title="Zoom out (Ctrl+-)"
        variant="ghost-muted"
      >
        <MinusIcon className="size-4" />
      </Button>
      <Button
        aria-label="Zoom to 100 percent"
        className="min-w-12 tabular-nums"
        onClick={onZoomTo100}
        size="sm"
        title="Zoom to 100% (Ctrl+1)"
        variant="ghost-muted"
      >
        {zoomPct}%
      </Button>
      <Button
        aria-label="Zoom in"
        onClick={onZoomIn}
        size="icon-xs"
        title="Zoom in (Ctrl+=)"
        variant="ghost-muted"
      >
        <PlusIcon className="size-4" />
      </Button>
      <span aria-hidden="true" className="mx-1 h-4 w-px bg-(--app-border)/70" />
      <Button
        aria-label="Fit view"
        onClick={onFitView}
        size="icon-xs"
        title="Fit view (Ctrl+0)"
        variant="ghost-muted"
      >
        <MaximizeIcon className="size-4" />
      </Button>
      {canZoomToSelection ? (
        <Button
          aria-label="Zoom to selection"
          onClick={onZoomToSelection}
          size="icon-xs"
          title="Zoom to selection (Ctrl+2)"
          variant="ghost-muted"
        >
          <FocusIcon className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

export function NoteGraphWalkthroughBar({
  index,
  total,
  title,
  onStep,
  onExit,
}: {
  index: number;
  total: number;
  title: string;
  onStep: (delta: 1 | -1) => void;
  onExit: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-(--app-border)/80 bg-(--app-page)/96 px-3 py-1.5 shadow-lg backdrop-blur">
      <span className="text-[10px] font-semibold tabular-nums text-(--app-muted)">
        {index + 1} of {total}
      </span>
      <span className="max-w-48 truncate text-xs font-medium text-(--app-text)">
        {title || "Untitled node"}
      </span>
      <Button
        aria-label="Previous node"
        onClick={() => onStep(-1)}
        size="icon-xs"
        variant="ghost-muted"
      >
        ←
      </Button>
      <Button aria-label="Next node" onClick={() => onStep(1)} size="icon-xs" variant="ghost-muted">
        →
      </Button>
      <Button aria-label="Exit walkthrough" onClick={onExit} size="icon-xs" variant="ghost-muted">
        <XIcon className="size-4" />
      </Button>
    </div>
  );
}

/** Every node as a list, top to bottom; picking one selects and shows it. */
export function NoteGraphOutline({
  nodes,
  selectedIds,
  onPick,
  onClose,
}: {
  nodes: readonly NoteGraphNode[];
  selectedIds: ReadonlySet<string>;
  onPick: (nodeId: string) => void;
  onClose: () => void;
}) {
  return (
    <aside
      aria-label="Node outline"
      className="flex min-h-0 w-60 shrink-0 flex-col self-end rounded-md border border-(--app-border)/80 bg-(--app-page)/96 shadow-lg backdrop-blur"
    >
      <div className="flex items-center justify-between border-b border-(--app-border)/60 px-3 py-2">
        <p className="text-xs font-semibold text-(--app-text)">Outline ({nodes.length})</p>
        <Button aria-label="Close outline" onClick={onClose} size="icon-xs" variant="ghost-muted">
          <XIcon className="size-4" />
        </Button>
      </div>
      <ul className="min-h-0 overflow-y-auto p-1.5">
        {[...nodes]
          .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
          .map((node) => (
            <li key={node.id}>
              <button
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-(--app-text) transition-colors hover:bg-(--app-page-2)",
                  selectedIds.has(node.id) && "bg-(--app-accent)/10",
                )}
                onClick={() => onPick(node.id)}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: resolveNoteGraphNodeHex(node) }}
                />
                <span className="truncate">{node.title.trim() || "Untitled node"}</span>
              </button>
            </li>
          ))}
      </ul>
    </aside>
  );
}

/* Canvas overlays placed at flow coordinates, so they stay put as the canvas pans and zooms. */
import { useViewport } from "@xyflow/react";

import { Input } from "../ui/Input";

type Point = { x: number; y: number };

/** Where a flow point sits inside the canvas, following pans and zooms. */
function useCanvasPoint(point: Point) {
  const { x, y, zoom } = useViewport();
  return { left: point.x * zoom + x, top: point.y * zoom + y };
}

/** Edits a connector's label in place, centred between its two nodes. */
export function NoteGraphEdgeLabelEditor({
  at,
  draft,
  onDraftChange,
  onCommit,
  onCancel,
}: {
  at: Point;
  draft: string;
  onDraftChange: (draft: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const position = useCanvasPoint(at);
  return (
    <div className="absolute z-40 -translate-x-1/2 -translate-y-1/2" style={position}>
      <Input
        aria-label="Connector label"
        autoFocus
        className="h-8 w-44 bg-(--app-page) text-xs shadow-lg"
        onBlur={onCommit}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onCommit();
          if (event.key === "Escape") onCancel();
        }}
        value={draft}
      />
    </div>
  );
}

/** The lines a dragged node snapped to. */
export function NoteGraphAlignmentGuides({ x, y }: { x: number | null; y: number | null }) {
  const position = useCanvasPoint({ x: x ?? 0, y: y ?? 0 });
  return (
    <>
      {x !== null ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-(--app-accent)"
          style={{ left: position.left }}
        />
      ) : null}
      {y !== null ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-0 right-0 z-20 h-px bg-(--app-accent)"
          style={{ top: position.top }}
        />
      ) : null}
    </>
  );
}

import { useRef, useState } from "react";
import { CopyIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "../ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/DropdownMenu";
import {
  encodeNoteGraphSnapshot,
  noteGraphSnapshotRect,
  readNoteGraphSnapshot,
} from "@loam/shared/notes/noteGraphSnapshot";
import type { NoteGraphSnapshot } from "@loam/shared/notes/noteModel";
import { clamp } from "../lib/clamp";
type Point = { x: number; y: number };

/**
 * Snapshot capture: drag a rectangle over the canvas, then insert the live snapshot into a
 * page tab of this note or copy it for another note.
 */
export function NoteGraphSnapshotCapture({
  noteId,
  tabId,
  pageTabs,
  screenToFlow,
  onInsert,
  announce,
  onClose,
}: {
  noteId: string;
  tabId: string;
  pageTabs: ReadonlyArray<{ id: string; title: string }>;
  screenToFlow: ((point: Point, options: { snapToGrid: boolean }) => Point | null) | null;
  /** Returns false when the snapshot could not be inserted. */
  onInsert?: (snapshot: NoteGraphSnapshot, pageTabId?: string) => boolean | void;
  announce: (message: string) => void;
  onClose: () => void;
}) {
  const [selection, setSelection] = useState<{
    start: { x: number; y: number };
    end: { x: number; y: number };
  } | null>(null);
  const [snapshot, setSnapshot] = useState<NoteGraphSnapshot | null>(null);
  const [copying, setCopying] = useState(false);
  const [message, setMessage] = useState("Drag a rectangle around any area. Escape to cancel.");
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const rect = selection ? noteGraphSnapshotRect(selection.start, selection.end) : null;
  const insert = (tabId?: string) => {
    if (!snapshot || !onInsert) return;
    if (onInsert(snapshot, tabId) !== false) onClose();
  };
  const copy = async () => {
    if (!snapshot || copying) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(encodeNoteGraphSnapshot(snapshot));
      announce("Snapshot copied. Paste it into any text note.");
      onClose();
    } catch {
      setMessage("Could not copy. Try again, or insert into a page tab below.");
    } finally {
      setCopying(false);
    }
  };
  return (
    <div
      data-graph-snapshot-capture=""
      aria-label="Select graph snapshot area"
      className="absolute inset-0 z-40 overflow-hidden outline-none"
      style={{ cursor: "crosshair", touchAction: "none" }}
      tabIndex={0}
      ref={(element) => {
        if (element && !element.contains(document.activeElement))
          element.focus({ preventScroll: true });
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (
          event.button !== 0 ||
          !screenToFlow ||
          (event.target instanceof Element && event.target.closest("button,[role=menu]"))
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        pointerIdRef.current = event.pointerId;
        startRef.current = { x: event.clientX, y: event.clientY };
        const box = event.currentTarget.getBoundingClientRect();
        const start = { x: event.clientX - box.left, y: event.clientY - box.top };
        setSelection({ start, end: start });
        setSnapshot(null);
      }}
      onPointerMove={(event) => {
        event.stopPropagation();
        if (pointerIdRef.current !== event.pointerId || !startRef.current) return;
        const box = event.currentTarget.getBoundingClientRect();
        setSelection({
          start: { x: startRef.current.x - box.left, y: startRef.current.y - box.top },
          end: {
            x: clamp(event.clientX - box.left, 0, box.width),
            y: clamp(event.clientY - box.top, 0, box.height),
          },
        });
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        const start = startRef.current;
        if (!start || pointerIdRef.current !== event.pointerId || !screenToFlow) return;
        pointerIdRef.current = null;
        startRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        const box = event.currentTarget.getBoundingClientRect();
        const end = {
          x: clamp(event.clientX, box.left, box.right),
          y: clamp(event.clientY, box.top, box.bottom),
        };
        const screenRect = noteGraphSnapshotRect(start, end);
        if (screenRect.width < 12 || screenRect.height < 12) {
          setSelection(null);
          setMessage("Drag a larger rectangle to capture an area.");
          return;
        }
        const flowStart = screenToFlow(start, { snapToGrid: false });
        const flowEnd = screenToFlow(end, { snapToGrid: false });
        if (!flowStart || !flowEnd) return;
        const captured = readNoteGraphSnapshot({
          noteId,
          tabId,
          ...noteGraphSnapshotRect(flowStart, flowEnd),
        });
        setSnapshot(captured);
        setMessage(
          captured
            ? "Live snapshot ready. Insert it here or copy it to another note."
            : "This area is too large. Select a smaller rectangle.",
        );
      }}
      onLostPointerCapture={() => {
        if (pointerIdRef.current === null) return;
        pointerIdRef.current = null;
        startRef.current = null;
        setSelection(null);
        setSnapshot(null);
      }}
      onPointerCancel={(event) => {
        event.stopPropagation();
        pointerIdRef.current = null;
        startRef.current = null;
        setSelection(null);
        setSnapshot(null);
      }}
    >
      {rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute border-2 border-(--app-accent) bg-(--app-accent)/5"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            boxShadow: "0 0 0 9999px color-mix(in srgb, var(--app-page) 35%, transparent)",
          }}
        />
      ) : null}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex justify-center">
        <p
          role="status"
          className="rounded-md border border-(--app-border) bg-(--app-page)/95 px-3 py-2 text-center text-xs text-(--app-text) shadow-sm"
        >
          {message}
        </p>
      </div>
      <div
        className="absolute inset-x-3 bottom-4 flex justify-center"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
      >
        <div
          className="flex flex-wrap items-center justify-center gap-2 rounded-lg border border-(--app-border) bg-(--app-page) p-2 shadow-lg"
          style={{ cursor: "default" }}
        >
          {snapshot && onInsert ? (
            pageTabs.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm">
                    <PlusIcon className="size-3.5" />
                    Insert into note
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center">
                  {pageTabs.map((tab) => (
                    <DropdownMenuItem key={tab.id} onSelect={() => insert(tab.id)}>
                      {tab.title || "Page tab"}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button size="sm" onClick={() => insert(pageTabs[0]?.id)}>
                <PlusIcon className="size-3.5" />
                {pageTabs.length ? "Insert into note" : "Insert into new page tab"}
              </Button>
            )
          ) : null}
          {snapshot ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={copying}
              onClick={() => {
                void copy();
              }}
            >
              <CopyIcon className="size-3.5" />
              {copying ? "Copying…" : "Copy snapshot"}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost-muted" onClick={onClose}>
            <XIcon className="size-3.5" />
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

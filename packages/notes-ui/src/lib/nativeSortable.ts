import { useEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";

import type { SortableInsertHalf } from "./moveItemBefore";

const NATIVE_SORTABLE_MIME = "application/x-loam-sortable";

export type NativeSortableMarker = {
  targetId: string;
  half: SortableInsertHalf;
  /** Over the middle of an item that takes items inside it. */
  inside?: boolean;
};

export type NativeSortableAxis = "vertical" | "horizontal";

export type NativeSortableMove = {
  sourceId: string;
  targetId: string;
  half: SortableInsertHalf;
  /** Dropped onto the middle of an item that takes items inside it. */
  inside: boolean;
};

const pointerHalf = (
  event: { clientX: number; clientY: number; currentTarget: HTMLElement },
  axis: NativeSortableAxis,
): SortableInsertHalf => {
  const rect = event.currentTarget.getBoundingClientRect();
  if (axis === "horizontal") {
    return event.clientX < rect.left + rect.width / 2 ? "before" : "after";
  }
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
};

/** The middle half of an item, top to bottom, drops inside it. */
const isPointerInside = (event: { clientY: number; currentTarget: HTMLElement }) => {
  const rect = event.currentTarget.getBoundingClientRect();
  const offset = (event.clientY - rect.top) / rect.height;
  return offset > 0.25 && offset < 0.75;
};

const readPayloadItemId = (dataTransfer: DataTransfer | null, instanceId: string) => {
  const typed = dataTransfer?.getData(NATIVE_SORTABLE_MIME) ?? "";
  const prefix = `${instanceId}:`;
  if (typed.startsWith(prefix)) return typed.slice(prefix.length);
  return null;
};

const nativeSortableMarkerClassName = (marker: NativeSortableMarker | null, itemId: string) => {
  if (!marker || marker.targetId !== itemId) return undefined;
  if (marker.inside) return "native-sortable-drop-inside";
  return marker.half === "before" ? "native-sortable-drop-before" : "native-sortable-drop-after";
};

/** What `data-drop-marker` says over an item: the side a drop lands on, or inside it. */
const markerAttribute = (
  marker: NativeSortableMarker | null,
  itemId: string,
): SortableInsertHalf | "inside" | undefined =>
  marker?.targetId === itemId ? (marker.inside ? "inside" : marker.half) : undefined;

/**
 * Reordering a list with native HTML drag and drop. Spread `itemProps(id)` on each item and
 * `zoneProps(id)` on extra drop areas; `onMove` gets the dragged id, the target id, the
 * side, and whether it landed inside an item `canNest` allows. The hovered target carries
 * `data-drop-marker` and `data-native-sortable-axis`, which styles/dropIndicators.css turns
 * into the drop line, or the outline of a drop inside.
 */
export const useNativeSortableList = ({
  axis = "vertical",
  canAcceptTarget,
  canNest,
  disabled = false,
  instanceId,
  onMove,
}: {
  axis?: NativeSortableAxis;
  canAcceptTarget?: (sourceId: string, targetId: string) => boolean;
  /** Whether the middle of `targetId` takes `sourceId` inside it; vertical lists only. */
  canNest?: (sourceId: string, targetId: string) => boolean;
  disabled?: boolean;
  instanceId: string;
  onMove: (input: NativeSortableMove) => boolean | void;
}) => {
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [marker, setMarker] = useState<NativeSortableMarker | null>(null);
  const sourceIdRef = useRef<string | null>(null);
  const sourceElementRef = useRef<HTMLElement | null>(null);
  const acceptedDragOverRef = useRef<Event | null>(null);
  const committedRef = useRef(false);

  const setActiveSourceId = (nextSourceId: string | null) => {
    sourceIdRef.current = nextSourceId;
    setSourceId(nextSourceId);
  };

  useEffect(() => {
    if (sourceId === null) return;
    // React can dispatch the accepted dragover at document. Ignore that same
    // event here, while clearing the marker when the pointer leaves a target.
    const clearInactiveMarker = (event: DragEvent) => {
      if (acceptedDragOverRef.current !== event) setMarker(null);
    };
    document.addEventListener("dragover", clearInactiveMarker);
    return () => document.removeEventListener("dragover", clearInactiveMarker);
  }, [sourceId]);

  const reset = () => {
    sourceElementRef.current = null;
    setActiveSourceId(null);
    setMarker(null);
    acceptedDragOverRef.current = null;
    committedRef.current = false;
  };

  // A removed source row never receives dragend, so abandon its drag instead
  // of leaving the marker up and letting a later drop move the missing item.
  useEffect(() => {
    if (sourceId !== null && sourceElementRef.current?.isConnected === false) reset();
  });

  const resolveSourceId = (dataTransfer?: DataTransfer | null) =>
    sourceIdRef.current ?? readPayloadItemId(dataTransfer ?? null, instanceId);

  const acceptsTarget = (nextSourceId: string, targetId: string) =>
    canAcceptTarget ? canAcceptTarget(nextSourceId, targetId) : true;

  const itemMarker = (
    event: { clientX: number; clientY: number; currentTarget: HTMLElement },
    nextSourceId: string,
    itemId: string,
  ): NativeSortableMarker => {
    const half = pointerHalf(event, axis);
    const inside =
      axis === "vertical" && isPointerInside(event) && Boolean(canNest?.(nextSourceId, itemId));
    return inside ? { targetId: itemId, half, inside } : { targetId: itemId, half };
  };

  const commit = (nextSourceId: string, nextMarker: NativeSortableMarker | null) => {
    if (disabled || committedRef.current || !nextMarker) return false;
    if (nextSourceId === nextMarker.targetId) return false;
    if (!acceptsTarget(nextSourceId, nextMarker.targetId)) return false;
    committedRef.current = true;
    const accepted = onMove({
      sourceId: nextSourceId,
      targetId: nextMarker.targetId,
      half: nextMarker.half,
      inside: Boolean(nextMarker.inside),
    });
    if (accepted === false) {
      committedRef.current = false;
      return false;
    }
    return true;
  };

  return {
    /** The hovered drop target and side, while a drag is over one. */
    marker,
    /** The item being dragged, while a drag from this list goes on. */
    sourceId,
    itemProps: (itemId: string, canDrag = !disabled) => ({
      draggable: canDrag,
      "data-native-sortable-id": itemId,
      "data-native-sortable-axis": axis,
      "data-drop-marker": markerAttribute(marker, itemId),
      className: nativeSortableMarkerClassName(marker, itemId),
      onDragStart: (event: ReactDragEvent<HTMLElement>) => {
        if (!canDrag) {
          event.preventDefault();
          return;
        }
        committedRef.current = false;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(NATIVE_SORTABLE_MIME, `${instanceId}:${itemId}`);
        acceptedDragOverRef.current = null;
        sourceElementRef.current = event.currentTarget;
        setActiveSourceId(itemId);
        setMarker(null);
      },
      onDragOver: (event: ReactDragEvent<HTMLElement>) => {
        const nextSourceId = resolveSourceId(event.dataTransfer);
        if (!nextSourceId || !canDrag) return;
        if (nextSourceId === itemId) {
          event.stopPropagation();
          setMarker(null);
          return;
        }
        if (!acceptsTarget(nextSourceId, itemId)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        acceptedDragOverRef.current = event.nativeEvent;
        setMarker(itemMarker(event, nextSourceId, itemId));
      },
      onDrop: (event: ReactDragEvent<HTMLElement>) => {
        const nextSourceId = resolveSourceId(event.dataTransfer);
        if (!nextSourceId || !canDrag) return;
        if (nextSourceId === itemId) {
          event.stopPropagation();
          reset();
          return;
        }
        if (!acceptsTarget(nextSourceId, itemId)) return;
        event.preventDefault();
        event.stopPropagation();
        commit(nextSourceId, itemMarker(event, nextSourceId, itemId));
        reset();
      },
      onDragEnd: reset,
    }),
    zoneProps: (zoneId: string, placement?: SortableInsertHalf) => ({
      "data-native-sortable-zone": zoneId,
      "data-native-sortable-axis": axis,
      "data-drop-marker": marker?.targetId === zoneId ? marker.half : undefined,
      className: nativeSortableMarkerClassName(marker, zoneId),
      onDragOver: (event: ReactDragEvent<HTMLElement>) => {
        const nextSourceId = resolveSourceId(event.dataTransfer);
        if (!nextSourceId || !acceptsTarget(nextSourceId, zoneId)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        acceptedDragOverRef.current = event.nativeEvent;
        setMarker({
          targetId: zoneId,
          half: placement ?? pointerHalf(event, axis),
        });
      },
      onDrop: (event: ReactDragEvent<HTMLElement>) => {
        const nextSourceId = resolveSourceId(event.dataTransfer);
        if (!nextSourceId || !acceptsTarget(nextSourceId, zoneId)) return;
        event.preventDefault();
        event.stopPropagation();
        commit(nextSourceId, { targetId: zoneId, half: placement ?? pointerHalf(event, axis) });
        reset();
      },
    }),
  };
};

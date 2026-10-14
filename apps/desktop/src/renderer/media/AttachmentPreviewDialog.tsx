import { useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";

import { cn } from "../ui/cn";
import { Button } from "../ui/Button";
import { Dialog, DialogClose, DialogOverlay, DialogPortal, DialogTitle } from "../ui/Dialog";
import { ShortcutHint } from "../keyboard/ShortcutHint";
import { RemoteAwareImage } from "./RemoteAwareImage";
import { clamp } from "../lib/clamp";

type AttachmentPreviewDialogProps = {
  /** The image to show, e.g. from `mediaSrc`; null keeps the dialog closed. */
  src: string | null;
  onClose: () => void;
};

const resolvePreviewCursor = (scale: number, isDragging: boolean) => {
  if (scale <= 1) return "default";
  if (isDragging) return "grabbing";
  return "grab";
};

const getContainedImageBounds = (image: HTMLImageElement) => {
  const rect = image.getBoundingClientRect();
  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;

  if (rect.width <= 0 || rect.height <= 0 || naturalWidth <= 0 || naturalHeight <= 0) {
    return rect;
  }

  const imageRatio = naturalWidth / naturalHeight;
  const rectRatio = rect.width / rect.height;

  if (imageRatio > rectRatio) {
    const height = rect.width / imageRatio;
    return {
      bottom: rect.top + (rect.height + height) / 2,
      left: rect.left,
      right: rect.right,
      top: rect.top + (rect.height - height) / 2,
    };
  }

  const width = rect.height * imageRatio;
  return {
    bottom: rect.bottom,
    left: rect.left + (rect.width - width) / 2,
    right: rect.left + (rect.width + width) / 2,
    top: rect.top,
  };
};

const isPointInsideBounds = (
  bounds: Pick<DOMRect, "bottom" | "left" | "right" | "top">,
  clientX: number,
  clientY: number,
) =>
  clientX >= bounds.left &&
  clientX <= bounds.right &&
  clientY >= bounds.top &&
  clientY <= bounds.bottom;

const isPointInsidePreviewImage = (image: HTMLImageElement, clientX: number, clientY: number) =>
  isPointInsideBounds(getContainedImageBounds(image), clientX, clientY);

/** Buttons drawn over the image, readable on any picture behind them. */
const overlayButtonClass =
  "rounded-full border border-white/30 bg-black/60 text-white hover:bg-black/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--app-focus-ring-on-dark) focus-visible:ring-offset-2 focus-visible:ring-offset-black";

/** A full-window, zoomable view of one image. */
export const AttachmentPreviewDialog = ({ src, onClose }: AttachmentPreviewDialogProps) => {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    pointerId: number;
  } | null>(null);
  const imageContainerRef = useRef<HTMLDivElement | null>(null);
  const zoomLabel = `${Math.round(scale * 100)}%`;

  const initializePreview = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setIsDragging(false);
    dragStartRef.current = null;
  };

  const handleContentPointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (typeof event.button === "number" && event.button > 0) return;

    const target = event.target;
    if (target instanceof Element && target.closest("button, a, [role='button']")) {
      return;
    }

    const image = imageContainerRef.current?.querySelector("img");
    if (image && isPointInsidePreviewImage(image, event.clientX, event.clientY)) {
      return;
    }

    onClose();
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const delta = -event.deltaY * 0.002;
    const nextScale = clamp(scale + delta, 1, 4);
    setScale(nextScale);
    if (nextScale === 1) {
      setOffset({ x: 0, y: 0 });
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || scale <= 1) return;
    event.preventDefault();
    const target = event.currentTarget;
    dragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
      pointerId: event.pointerId,
    };
    setIsDragging(true);
    target.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const deltaX = event.clientX - dragStartRef.current.x;
    const deltaY = event.clientY - dragStartRef.current.y;
    setOffset({
      x: dragStartRef.current.offsetX + deltaX,
      y: dragStartRef.current.offsetY + deltaY,
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    event.currentTarget.releasePointerCapture(dragStartRef.current.pointerId);
    dragStartRef.current = null;
    setIsDragging(false);
  };

  const handleResetZoom = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  return (
    <Dialog
      open={src !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay className="z-[90]" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-8"
          onOpenAutoFocus={initializePreview}
          onPointerDownCapture={handleContentPointerDownCapture}
        >
          <DialogTitle className="sr-only">Attachment preview</DialogTitle>
          <ShortcutHint label="Close preview" shortcut="preview.close">
            <DialogClose asChild>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn("absolute right-4 top-4 z-10 px-4", overlayButtonClass)}
              >
                <XIcon className="size-4" />
                Close
              </Button>
            </DialogClose>
          </ShortcutHint>
          <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleResetZoom}
              className={cn("px-4", overlayButtonClass)}
            >
              {zoomLabel}
            </Button>
          </div>
          {src ? (
            <div className="relative flex h-full w-full items-center justify-center">
              <div
                ref={imageContainerRef}
                className="relative h-full w-full max-h-[calc(100dvh-6rem)] max-w-[min(1400px,100%)]"
                onWheel={handleWheel}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                style={{
                  touchAction: "none",
                  cursor: resolvePreviewCursor(scale, isDragging),
                }}
              >
                <div
                  className="absolute inset-0"
                  style={{
                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                    transformOrigin: "center",
                  }}
                >
                  <RemoteAwareImage
                    src={src}
                    alt="Attachment preview"
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 90vw, 80vw"
                    className="rounded-2xl object-contain shadow-(--shadow-elevated)"
                    draggable={false}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};

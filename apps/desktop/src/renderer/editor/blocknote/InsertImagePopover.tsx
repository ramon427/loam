import { useCallback, useId, useMemo, useRef, useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { ImagePlusIcon, CloudUploadIcon } from "lucide-react";

import { PopoverContent } from "../../ui/Popover";
import { cn } from "../../ui/cn";
import { FOCUS_RING_CLASS } from "../../styles/controlInteraction";
import {
  isSupportedImageFile,
  imageInputAccept,
  imageUploadErrorMessage,
} from "../../media/imageFileTypes";

type InsertImagePopoverProps = {
  open: boolean;
  /** Where the empty image block's "Add image" button was when the popover opened. */
  anchorRect: DOMRect | null;
  onOpenChange: (open: boolean) => void;
  /** Called after a file is rejected, e.g. to drop the empty image block. */
  onInvalidImageInput?: () => void;
  /** Puts a saved image's media path into the target block. */
  onInsertImage: (path: string) => void;
  /** Saves a file and resolves to its media path; rejects when the save fails. */
  onUploadFile: (file: File) => Promise<string>;
};

/** Saves a picked or dropped image file into an empty image block. */
export function InsertImagePopover({
  open,
  anchorRect,
  onOpenChange,
  onInvalidImageInput,
  onInsertImage,
  onUploadFile,
}: InsertImagePopoverProps) {
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const errorId = useId();
  const anchor = useMemo(
    () => ({ current: { getBoundingClientRect: () => anchorRect ?? new DOMRect() } }),
    [anchorRect],
  );

  const close = useCallback(() => {
    setError(null);
    onOpenChange(false);
  }, [onOpenChange]);

  const reject = (message: string) => {
    setError(message);
    onInvalidImageInput?.();
  };

  const upload = async (file: File | undefined) => {
    if (!file || isUploading) return;
    if (!isSupportedImageFile(file)) {
      reject(imageUploadErrorMessage);
      return;
    }
    setIsUploading(true);
    setError(null);
    try {
      onInsertImage(await onUploadFile(file));
      close();
    } catch {
      setError("Upload failed. Try again.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <PopoverPrimitive.Root
      open={open && anchorRect !== null}
      onOpenChange={(next) => {
        if (!next && !isUploading) close();
      }}
    >
      <PopoverPrimitive.Anchor virtualRef={anchor} />
      <PopoverPrimitive.Portal>
        <PopoverContent
          side="bottom"
          collisionPadding={12}
          className="z-[10080] w-[320px] max-w-[calc(100vw-24px)]"
          data-insert-image-popover="true"
          onOpenAutoFocus={() => {
            const opener = document.activeElement;
            openerRef.current = opener instanceof HTMLElement ? opener : null;
          }}
          onCloseAutoFocus={(event) => {
            // The anchor is virtual, so focus goes back to where it was, usually the editor.
            event.preventDefault();
            if (openerRef.current?.isConnected) openerRef.current.focus({ preventScroll: true });
          }}
        >
          <div className="flex items-start gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-md border border-(--app-border)/60 bg-(--app-page-2)/75 text-(--app-muted)">
              <ImagePlusIcon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 space-y-0.5">
              <p className="text-[13px] font-semibold leading-5 text-(--text)">Insert image</p>
              <p className="text-[11px] leading-4 text-(--muted-text)">
                Choose an image file or drop one here.
              </p>
            </div>
          </div>

          <div
            className="mt-3 space-y-2"
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(event) => {
              event.preventDefault();
              void upload(event.dataTransfer.files[0]);
            }}
          >
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              aria-describedby={error ? errorId : undefined}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md border border-dashed border-(--app-border)/70 bg-(--app-page-2)/55 px-3 py-2 text-left",
                "text-(--app-text) transition-colors duration-120 hover:border-(--app-border-strong) hover:bg-(--app-page-2)",
                "disabled:cursor-not-allowed disabled:opacity-60",
                FOCUS_RING_CLASS,
              )}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-md border border-(--app-border)/60 bg-(--app-page) text-(--app-muted)">
                <CloudUploadIcon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold leading-4">
                  {isUploading ? "Uploading..." : "Choose image"}
                </span>
                <span className="block text-[11px] leading-4 text-(--muted-text)">
                  JPG, PNG, GIF, WEBP
                </span>
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              aria-label="Choose image file"
              accept={imageInputAccept}
              onChange={(event) => {
                const input = event.currentTarget;
                void upload(input.files?.[0]).finally(() => {
                  // Lets the same file be picked again after a failure.
                  input.value = "";
                });
              }}
              disabled={isUploading}
              className="sr-only"
            />
            {error ? (
              <p id={errorId} role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </PopoverContent>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

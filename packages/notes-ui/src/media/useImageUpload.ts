import { useCallback, useEffect, useId, useRef } from "react";

import { callBridge } from "../host/notesHost";
import { dismissToast, toastError } from "../ui/toast";
import { isSupportedImageFile, imageUploadErrorMessage } from "./imageFileTypes";

/** The media-folder path of a saved image; blocks and graph nodes store this. */
export type ImageUploadResult = { path: string };

const maxImageBytes = 5 * 1024 * 1024;
const uploadTimeoutMs = 20_000;

class UploadTimeoutError extends Error {}

// The IPC call can't be cancelled, so a slow save is abandoned rather than aborted.
const saveImageWithTimeout = async (file: File) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new UploadTimeoutError()), uploadTimeoutMs);
  });
  try {
    const saving = file
      .arrayBuffer()
      .then((buffer) => callBridge("media.saveImage", { bytes: new Uint8Array(buffer) }));
    return await Promise.race([saving, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Validates an image and saves it to the media folder. Failures are shown as a
 * toast and resolve to null; results that arrive after unmount are dropped.
 */
export function useImageUpload() {
  const toastId = `image-upload:${useId()}`;
  // One token per mount: an upload compares against it to learn it outlived its component.
  const mountRef = useRef<object | null>(null);

  useEffect(() => {
    const mount = {};
    mountRef.current = mount;
    return () => {
      mountRef.current = null;
      dismissToast(toastId);
    };
  }, [toastId]);

  const uploadImage = useCallback(
    async (file: File): Promise<ImageUploadResult | null> => {
      const mount = mountRef.current;
      if (!mount) return null;
      dismissToast(toastId);
      if (!isSupportedImageFile(file)) {
        toastError(imageUploadErrorMessage, { id: toastId });
        return null;
      }
      if (file.size > maxImageBytes) {
        toastError("Images must be 5MB or smaller.", { id: toastId });
        return null;
      }
      try {
        const { path } = await saveImageWithTimeout(file);
        return mountRef.current === mount ? { path } : null;
      } catch (error) {
        if (mountRef.current !== mount) return null;
        console.error(error);
        const message =
          error instanceof UploadTimeoutError
            ? "Upload timed out. Try again."
            : "Upload failed. Try again.";
        toastError(message, { id: toastId });
        return null;
      }
    },
    [toastId],
  );

  return { uploadImage };
}

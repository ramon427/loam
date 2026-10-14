import { callBridge, BridgeError } from "../bridge";
import { toastError } from "../ui/toast";

/*
 * Copies of a note's saved image, by its media path: on the clipboard or in a file the user
 * picks. A failure is told in a toast, so callers only start them.
 */

/** Puts the image on the system clipboard. */
export async function copyImage(path: string) {
  try {
    await callBridge("media.copyImage", { reference: path });
  } catch (error) {
    toastError(
      error instanceof BridgeError && error.code === "MEDIA_TYPE_UNSUPPORTED"
        ? "Only PNG and JPEG images can be copied. Use Save image as instead."
        : "Could not copy this image. Try again.",
    );
  }
}

/** Asks where to save a copy of the image, and saves it there. */
export async function saveImageAs(path: string) {
  try {
    await callBridge("media.saveImageAs", { reference: path });
  } catch {
    toastError("Could not save a copy of this image. Try again.");
  }
}

import { isSupportedImageFile } from "../media/imageFileTypes";
import { toastInfo } from "../ui/toast";

/**
 * Stops a paste or drop that carries anything but supported images, and says
 * why. Notes can only keep images; returns true when the event was stopped.
 */
export function rejectNonImageFiles(event: ClipboardEvent | DragEvent): boolean {
  const data = "clipboardData" in event ? event.clipboardData : event.dataTransfer;
  const files = Array.from(data?.files ?? []);
  if (!files.some((file) => !isSupportedImageFile(file))) return false;
  event.preventDefault();
  toastInfo("This file type cannot be added", {
    id: "notes:unsupported-attachment",
    description:
      "Notes currently support image attachments. PDFs, audio, video and other files cannot be pasted or dropped here.",
  });
  return true;
}

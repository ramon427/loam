import { useCallback, useEffect, useState } from "react";

import type { BridgeLinkedFile } from "@loam/shared/bridge/loamBridge";

import { callBridge, onBridgeEvent } from "../bridge";
import { toastError } from "../ui/toast";

/** The names of files a file tab opens, as dropping one on the window goes by. */
const OPENABLE_NAME = /\.(?:pdf|docx|md|markdown)$/i;
const OPENABLE_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/x-markdown",
]);

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "This file can't be opened.";

/**
 * Where the dropped PDF, Word and Markdown files are on this computer. A file
 * with no place there, such as one dragged from a web page, is left to the
 * editor under it.
 */
const droppedPaths = (event: DragEvent) =>
  [...(event.dataTransfer?.files ?? [])].flatMap((file) => {
    const path = OPENABLE_NAME.test(file.name) ? window.loam.pathForFile(file) : "";
    return path ? [path] : [];
  });

/**
 * Files opened from outside the notes: picked with Open a file, dropped on
 * the window, or sent by the system ("Open with"). Each shows in turn until
 * it is kept as a reference or closed; `current` is the one showing.
 */
export function useOpenedFiles({ enabled }: { enabled: boolean }) {
  const [queue, setQueue] = useState<BridgeLinkedFile[]>([]);
  const show = useCallback((files: readonly BridgeLinkedFile[]) => {
    if (files.length > 0) setQueue((current) => [...current, ...files]);
  }, []);

  // What the system sent before the notes were open waits in the main process until now.
  useEffect(() => {
    if (!enabled) return;
    const take = () => void callBridge("files.takeOpened", {}).then(show, () => undefined);
    take();
    return onBridgeEvent("files.waiting", take);
  }, [enabled, show]);

  // A PDF, Word or Markdown file dropped anywhere opens here, before an editor can take it.
  useEffect(() => {
    if (!enabled) return;
    // Names are known only at the drop; while dragging, the types say which files can land.
    const over = (event: DragEvent) => {
      const items = [...(event.dataTransfer?.items ?? [])];
      if (items.some((item) => item.kind === "file" && OPENABLE_TYPES.has(item.type)))
        event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-takes-file-drops]"))
        return;
      const paths = droppedPaths(event);
      if (paths.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      void Promise.all(
        paths.map((path) =>
          callBridge("files.link", { path }).catch((error: unknown) => {
            toastError(errorMessage(error));
            return null;
          }),
        ),
      ).then((linked) => show(linked.filter((file) => file !== null)));
    };
    window.addEventListener("dragover", over, true);
    window.addEventListener("drop", drop, true);
    return () => {
      window.removeEventListener("dragover", over, true);
      window.removeEventListener("drop", drop, true);
    };
  }, [enabled, show]);

  const pick = useCallback(async () => {
    try {
      const picked = await callBridge("files.pick", {});
      if (picked) show([picked]);
    } catch (error) {
      toastError(errorMessage(error));
    }
  }, [show]);

  const close = useCallback(() => setQueue((current) => current.slice(1)), []);

  return { current: queue[0] ?? null, pick, close };
}

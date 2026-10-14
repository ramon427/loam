let pendingUploads = 0;

const keepWindowOpen = (event: BeforeUnloadEvent) => {
  event.preventDefault();
};

/**
 * Marks an image upload as in flight so the window can't close (or reload)
 * before the file is saved and the note points at it. Call the returned
 * function once when the upload settles, whatever its outcome.
 */
export const beginPendingUpload = () => {
  pendingUploads += 1;
  if (pendingUploads === 1) window.addEventListener("beforeunload", keepWindowOpen);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    pendingUploads -= 1;
    if (pendingUploads === 0) window.removeEventListener("beforeunload", keepWindowOpen);
  };
};

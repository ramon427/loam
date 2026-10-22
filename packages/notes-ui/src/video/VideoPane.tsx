import type { PointerEvent, ReactNode } from "react";

import { cn } from "../ui/cn";

import { MAX_VIDEO_PANE_WIDTH, MIN_VIDEO_PANE_WIDTH } from "./useVideoPane";
import styles from "./videoPane.module.css";

/**
 * The column of the note's paper beside the note: its video, or a file tab
 * shown there. A seam resizes it (unless it fills the paper). Its content
 * stays in view while the note scrolls beside it.
 */
export function VideoPane({
  label = "Video",
  width,
  maximized,
  onStartResize,
  children,
}: {
  label?: string;
  width: number;
  maximized: boolean;
  onStartResize: (event: PointerEvent<HTMLElement>) => void;
  children: ReactNode;
}) {
  return (
    <aside aria-label={label} className={cn(styles.pane, maximized && styles.maximized)}>
      {maximized ? null : (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${label.toLowerCase()} pane`}
          aria-valuemin={MIN_VIDEO_PANE_WIDTH}
          aria-valuemax={MAX_VIDEO_PANE_WIDTH}
          aria-valuenow={width}
          className={styles.seam}
          onPointerDown={onStartResize}
        />
      )}
      <div className={styles.body}>{children}</div>
    </aside>
  );
}

import type { HTMLAttributes } from "react";

const formattingToolbarPopoverProps = {
  "data-loam-formatting-toolbar-popover": "true",
  style: { zIndex: 10070 },
} as HTMLAttributes<HTMLDivElement>;

export const formattingToolbarFloatingOptions = {
  elementProps: formattingToolbarPopoverProps,
  useDismissProps: {
    // Preserve the selection, but release floating positioning while its page moves.
    ancestorScroll: true,
    outsidePress: false,
    referencePress: false,
  },
  useTransitionStylesProps: {
    duration: { open: 120, close: 120 },
  },
  useTransitionStatusProps: {
    duration: { open: 120, close: 120 },
  },
};

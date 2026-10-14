// Floating UI freezes the last open HTML while transitioning out. A non-zero
// close duration reinserts that HTML and restarts CSS enter animations.
export const slashMenuFloatingOptions = {
  useTransitionStylesProps: {
    duration: { open: 120, close: 0 },
  },
  useTransitionStatusProps: {
    duration: { open: 120, close: 0 },
  },
} as const;

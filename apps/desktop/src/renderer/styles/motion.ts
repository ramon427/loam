/** How long quick fades take: panel switches, new tree rows, editor content. Matches --duration-fast. */
export const FAST_MOTION_MS = 150;

/** The app's easing curve, as framer-motion takes it. Matches --ease-out. */
export const STANDARD_EASING = [0.16, 1, 0.3, 1] as const;

export const fastUiTransitionClass = "duration-(--duration-fast) ease-(--ease-out)";

export const CONTROL_TRANSITION_TIMING_CLASS =
  "duration-[var(--control-transition-duration)] ease-[var(--control-transition-easing)]";

export const FOCUS_RING_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--app-focus-ring) focus-visible:ring-offset-1 focus-visible:ring-offset-(--app-page)";

export const NESTED_FOCUS_RESET_CLASS = "focus-visible:ring-0 focus-visible:ring-offset-0";

export const HIT_TARGET_CLASS = "min-h-[var(--app-hit-target)]";

export const HIT_TARGET_MIN_CLASS =
  "min-h-[var(--app-hit-target-min)] min-w-[var(--app-hit-target-min)]";

export const DISABLED_CONTROL_CLASS =
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-[var(--app-disabled-opacity)] aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-[var(--app-disabled-opacity)]";

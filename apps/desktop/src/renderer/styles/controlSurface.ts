import { cn } from "../ui/cn";

const raisedTransitionClass =
  "transition-[color,background-color,border-color,box-shadow] duration-(--control-transition-duration) ease-(--control-transition-easing) motion-reduce:transition-none";

const raisedPanelEdgeClass =
  "rounded-(--radius-menu) border border-(--raised-panel-border) text-(--text) shadow-(--raised-panel-shadow)";

/** Dialogs: solid, since the page behind them is already dimmed and blurred. Dark panels sit a step above the page. */
export const raisedPanelClass = cn(
  raisedPanelEdgeClass,
  "bg-(--app-surface-overlay)",
  raisedTransitionClass,
);

/** Menus and popovers float right over the page, so they are thick glass. */
export const glassPanelClass = cn(
  raisedPanelEdgeClass,
  "surface-glass surface-glass-thick [--glass-tint:var(--app-surface-overlay)]",
  raisedTransitionClass,
);

/** Fields drawn on the raised surface: text areas and input groups. */
export const raisedControlClass = cn(
  "rounded-(--raised-control-radius) border border-(--control-border) bg-(--raised-control-bg) text-(--text) shadow-(--raised-control-shadow) hover:border-(--control-border-hover) focus-visible:shadow-[0_0_0_1px_var(--control-border),inset_0_0_0_1px_color-mix(in_srgb,var(--text)_22%,transparent)] aria-invalid:border-(--status-danger) aria-invalid:shadow-[0_0_0_1px_var(--status-danger),inset_0_0_0_1px_color-mix(in_srgb,var(--status-danger)_22%,transparent)]",
  raisedTransitionClass,
);

/** A bordered field: inputs and select triggers. */
export const controlSurfaceClass =
  "rounded-[var(--radius-control)] border border-(--control-border) bg-(--raised-control-bg) text-(--text) shadow-(--raised-control-shadow) transition-[color,background-color,border-color,box-shadow] duration-[var(--duration-hover)] hover:border-(--control-border-hover) hover:text-(--text) focus-visible:border-(--control-border-strong) focus-visible:text-(--text) focus-visible:shadow-none";

export const controlSurfaceOpenClass = "data-[state=open]:text-(--text)";

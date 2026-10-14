import { cn } from "../ui/cn";

const raisedTransitionClass =
  "transition-[color,background-color,border-color,box-shadow] duration-(--control-transition-duration) ease-(--control-transition-easing) motion-reduce:transition-none";

/** Floating panels: menus, popovers and dialogs. Dark panels sit a step above the page. */
export const raisedPanelClass = cn(
  "rounded-(--raised-control-radius) border border-(--control-border) bg-(--raised-control-bg) text-(--text) shadow-(--raised-control-shadow) dark:[--raised-control-bg:var(--app-surface-overlay)]",
  raisedTransitionClass,
);

/** Fields drawn on the raised surface: text areas and input groups. */
export const raisedControlClass = cn(
  "rounded-(--raised-control-radius) border border-(--control-border) bg-(--raised-control-bg) text-(--text) shadow-(--raised-control-shadow) hover:bg-(--raised-control-hover-bg) focus-visible:bg-(--raised-control-bg) focus-visible:shadow-[0_0_0_1px_var(--control-border),inset_0_0_0_1px_color-mix(in_srgb,var(--text)_22%,transparent)] aria-invalid:border-(--status-danger) aria-invalid:shadow-[0_0_0_1px_var(--status-danger),inset_0_0_0_1px_color-mix(in_srgb,var(--status-danger)_22%,transparent)]",
  raisedTransitionClass,
);

export const controlSurfaceClass =
  "rounded-[var(--radius-control)] border border-(--control-border) bg-(--card-bg)/90 font-medium text-(--text) shadow-(--raised-control-shadow) dark:shadow-sm transition-[color,background-color,border-color,box-shadow] duration-[var(--duration-hover)] hover:border-(--control-border-hover) hover:bg-(--app-page-2) hover:text-(--text) focus-visible:border-(--control-border-strong) focus-visible:bg-(--card-bg) focus-visible:text-(--text) focus-visible:shadow-none";

export const controlSurfaceOpenClass = "data-[state=open]:text-(--text)";

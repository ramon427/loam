import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./cn";
import { controlSurfaceClass } from "../styles/controlSurface";
import {
  CONTROL_TRANSITION_TIMING_CLASS,
  DISABLED_CONTROL_CLASS,
  FOCUS_RING_CLASS,
  HIT_TARGET_MIN_CLASS,
} from "../styles/controlInteraction";

const ghostClass =
  "bg-transparent text-(--text) hover:bg-[color-mix(in_srgb,var(--text)_7%,transparent)] focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--text)_18%,transparent)]";

const destructiveFocusClass =
  "focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--status-danger)_28%,transparent)]";

export const buttonVariants = cva(
  cn(
    "inline-flex min-w-[calc(7ch+1.5rem)] shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-(--raised-control-radius) text-xs leading-none font-[var(--h2-weight)] whitespace-nowrap select-none transition-[color,background-color,border-color,box-shadow,opacity,transform] active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    CONTROL_TRANSITION_TIMING_CLASS,
    FOCUS_RING_CLASS,
    DISABLED_CONTROL_CLASS,
  ),
  {
    variants: {
      variant: {
        default:
          "bg-(--text) text-(--app-page) shadow-sm hover:opacity-90 dark:bg-(--app-accent) dark:text-(--app-accent-foreground)",
        outline: cn(controlSurfaceClass, "focus-visible:ring-0 focus-visible:ring-offset-0"),
        outlineMuted:
          "border border-(--pill-border)/70 bg-transparent text-(--text) hover:bg-(--app-surface-2)",
        secondary: "bg-(--pill-bg) text-(--text) hover:bg-(--control-hover-on-pill)",
        ghost: ghostClass,
        "ghost-muted": cn(ghostClass, "text-(--muted-text) hover:text-(--text)"),
        link: "h-auto min-w-0 justify-start px-0 text-(--text) underline-offset-4 hover:underline",
        destructive: cn(
          "bg-destructive/15 text-destructive shadow-none hover:bg-destructive/20",
          destructiveFocusClass,
        ),
        "ghost-destructive": cn(
          "bg-transparent text-destructive hover:bg-destructive/13",
          destructiveFocusClass,
        ),
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2.5 text-[12px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 px-4 text-[13px]",
        full: "h-8 w-full px-3",
        icon: cn("size-8 min-w-(--app-hit-target) px-0", HIT_TARGET_MIN_CLASS),
        "icon-sm": cn(
          "size-7 min-w-(--app-hit-target-min) px-0 [&_svg:not([class*='size-'])]:size-3.5",
          HIT_TARGET_MIN_CLASS,
        ),
        "icon-xs": cn(
          "size-6 min-w-(--app-hit-target-min) px-0 [&_svg:not([class*='size-'])]:size-3.5",
          HIT_TARGET_MIN_CLASS,
        ),
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = React.ComponentPropsWithRef<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

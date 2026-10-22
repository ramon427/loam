import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./cn";
import {
  CONTROL_TRANSITION_TIMING_CLASS,
  DISABLED_CONTROL_CLASS,
  FOCUS_RING_CLASS,
  HIT_TARGET_MIN_CLASS,
} from "../styles/controlInteraction";

const ghostClass =
  "bg-transparent text-(--app-secondary-label) hover:bg-(--app-control-hover) hover:text-(--text) data-[state=open]:bg-(--app-control-hover) data-[state=open]:text-(--text) focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--text)_18%,transparent)]";

/** The bordered secondary button. */
const borderedClass =
  "border border-(--button-secondary-border) bg-(--button-secondary-bg) text-(--text) hover:bg-(--button-secondary-hover-bg) focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-[0_0_0_1px_var(--app-focus-ring)]";

const destructiveFocusClass =
  "focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--status-danger)_28%,transparent)]";

export const buttonVariants = cva(
  cn(
    "inline-flex min-w-[calc(7ch+1.5rem)] shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-1.5 rounded-(--raised-control-radius) text-[13px] leading-none font-medium whitespace-nowrap select-none transition-[color,background-color,border-color,box-shadow,opacity,transform] active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    CONTROL_TRANSITION_TIMING_CLASS,
    FOCUS_RING_CLASS,
    DISABLED_CONTROL_CLASS,
  ),
  {
    variants: {
      variant: {
        default:
          "bg-(--app-accent) text-(--app-accent-foreground) hover:bg-(--app-accent-2) data-[state=open]:bg-(--app-accent-2)",
        outline: borderedClass,
        outlineMuted:
          "border border-(--app-border) bg-transparent text-(--text) hover:bg-(--app-control-hover)",
        secondary: borderedClass,
        ghost: ghostClass,
        "ghost-muted": cn(ghostClass, "text-(--muted-text) hover:text-(--text)"),
        link: "h-auto min-w-0 justify-start px-0 text-(--text) underline-offset-4 hover:underline",
        destructive: cn(
          "bg-destructive text-white shadow-none hover:bg-[color-mix(in_srgb,var(--status-danger)_88%,black)]",
          destructiveFocusClass,
        ),
        "ghost-destructive": cn(
          "bg-transparent text-destructive hover:bg-destructive/13",
          destructiveFocusClass,
        ),
      },
      size: {
        default: "h-8 px-[13px]",
        sm: "h-7 px-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 px-4 text-[14px]",
        full: "h-8 w-full px-[13px]",
        icon: cn(
          "size-[30px] min-w-[30px] rounded-[8px] px-0 [&_svg:not([class*='size-'])]:size-4",
          HIT_TARGET_MIN_CLASS,
        ),
        "icon-sm": cn(
          "size-7 min-w-(--app-hit-target-min) rounded-[8px] px-0 [&_svg:not([class*='size-'])]:size-3.5",
          HIT_TARGET_MIN_CLASS,
        ),
        "icon-xs": cn(
          "size-6 min-w-(--app-hit-target-min) rounded-[7px] px-0 [&_svg:not([class*='size-'])]:size-3.5",
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

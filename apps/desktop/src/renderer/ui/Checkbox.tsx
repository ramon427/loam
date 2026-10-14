import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon } from "lucide-react";

import { cn } from "./cn";
import { DISABLED_CONTROL_CLASS } from "../styles/controlInteraction";

const checkboxClass = cn(
  "peer inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-(--raised-control-radius) border border-(--control-border) bg-(--raised-control-bg) text-(--text) shadow-(--raised-control-shadow) outline-none",
  "transition-[color,background-color,border-color,box-shadow] duration-120 ease-[cubic-bezier(0,0,0.2,1)] motion-reduce:transition-none",
  "hover:bg-(--raised-control-hover-bg)",
  // Light mode fills the checked box more strongly than a selected button.
  "data-[state=checked]:border-[color-mix(in_srgb,var(--app-surface)_62%,var(--app-text))] data-[state=checked]:bg-[color-mix(in_srgb,var(--app-surface)_88%,var(--app-text))] data-[state=checked]:text-(--control-selected-text) data-[state=checked]:shadow-[inset_0_1px_0_rgb(0_0_0/0.04)] data-[state=checked]:hover:bg-[color-mix(in_srgb,var(--app-surface)_82%,var(--app-text))]",
  "dark:data-[state=checked]:border-(--control-selected-border) dark:data-[state=checked]:bg-(--control-selected-bg) dark:data-[state=checked]:shadow-(--control-selected-shadow) dark:data-[state=checked]:hover:bg-(--control-selected-hover-bg)",
  "focus-visible:border-(--control-border)! focus-visible:shadow-[0_0_0_1px_var(--control-border),inset_0_0_0_1px_color-mix(in_srgb,var(--text)_22%,transparent)]!",
  DISABLED_CONTROL_CLASS,
);

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(checkboxClass, className)}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        <CheckIcon className="size-3" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };

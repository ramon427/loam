import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon } from "lucide-react";

import { cn } from "./cn";
import { DISABLED_CONTROL_CLASS } from "../styles/controlInteraction";

const checkboxClass = cn(
  "peer inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[5px] border-[1.5px] border-(--app-input) bg-transparent text-(--app-accent-foreground) outline-none",
  "transition-[color,background-color,border-color,box-shadow] duration-120 ease-[cubic-bezier(0,0,0.2,1)] motion-reduce:transition-none",
  "hover:border-(--control-border-strong)",
  "data-[state=checked]:border-(--app-accent) data-[state=checked]:bg-(--app-accent) data-[state=checked]:hover:border-(--app-accent-2) data-[state=checked]:hover:bg-(--app-accent-2)",
  "focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--app-accent)_35%,transparent)]",
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
        <CheckIcon className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };

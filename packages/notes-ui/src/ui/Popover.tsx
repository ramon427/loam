import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "./cn";
import { dropdownSurfaceClass } from "../styles/dropdowns";

function PopoverContent({
  className,
  sideOffset = 8,
  ref,
  ...props
}: React.ComponentPropsWithRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Content
      data-slot="popover-content"
      ref={ref}
      sideOffset={sideOffset}
      className={cn("z-50 outline-none", dropdownSurfaceClass, className)}
      {...props}
    />
  );
}

export { PopoverContent };

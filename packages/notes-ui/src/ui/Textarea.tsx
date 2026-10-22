import type * as React from "react";

import { cn } from "./cn";
import { DISABLED_CONTROL_CLASS } from "../styles/controlInteraction";
import { raisedControlClass } from "../styles/controlSurface";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        raisedControlClass,
        "flex max-h-100 min-h-20 w-full min-w-0 resize-y px-2.5 py-2 text-[13px] text-(--app-text) outline-none placeholder:text-(--app-placeholder)",
        DISABLED_CONTROL_CLASS,
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };

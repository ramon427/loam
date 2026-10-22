import type { ComponentProps } from "react";
import { cn } from "./cn";
import { raisedControlClass } from "../styles/controlSurface";
import { Input } from "./Input";

export function InputGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        raisedControlClass,
        "flex h-8 w-full min-w-0 items-center gap-2 px-2.5",
        "has-focus-visible:shadow-[0_0_0_1px_var(--control-border),inset_0_0_0_1px_color-mix(in_srgb,var(--text)_22%,transparent)]",
        "has-aria-invalid:border-(--status-danger) has-aria-invalid:shadow-[0_0_0_1px_var(--status-danger),inset_0_0_0_1px_color-mix(in_srgb,var(--status-danger)_22%,transparent)]",
        "has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-[var(--app-disabled-opacity)]",
        className,
      )}
      {...props}
    />
  );
}

export function InputGroupInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <Input
      surface="plain"
      className={cn(
        "h-full min-h-0 flex-1 rounded-none px-0 py-0 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:appearance-none",
        className,
      )}
      {...props}
    />
  );
}

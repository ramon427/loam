import type { ComponentProps } from "react";

import { cn } from "../ui/cn";
import { DropdownMenuTrigger } from "../ui/DropdownMenu";

/** The compact button that opens a menu in the graph's toolbars and panels. */
export function NoteGraphMenuTrigger({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuTrigger>) {
  return (
    <DropdownMenuTrigger
      type="button"
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-(--app-border)/70 bg-(--card-bg)/90 px-2.5 text-xs font-medium text-(--app-text) transition-colors hover:bg-(--app-page-2) disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

import { Slot } from "@radix-ui/react-slot";
import type { ComponentPropsWithoutRef } from "react";

import { fastUiTransitionClass } from "../styles/motion";
import { cn } from "./cn";

// Every row is 28px tall (py-1.5 around a 16px line).
const sidebarRowClassName = `flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-4 text-[color:var(--sidebar-foreground,var(--app-muted))] transition-all ${fastUiTransitionClass} hover:bg-(--sidebar-item-hover-bg) hover:text-(--app-text) focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--app-border)/25 focus-visible:ring-offset-1 focus-visible:ring-offset-(--app-page) disabled:cursor-default disabled:opacity-50 [&>svg]:block [&>svg]:-translate-y-px`;

/** A row in a sidebar list: the notes tree and the settings sections. */
export function SidebarRow({
  asChild = false,
  isActive = false,
  isOpen = false,
  className,
  ...props
}: ComponentPropsWithoutRef<"button"> & {
  asChild?: boolean;
  isActive?: boolean;
  isOpen?: boolean;
}) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      type={asChild ? undefined : "button"}
      className={cn(
        sidebarRowClassName,
        isOpen && "text-(--app-text)",
        isActive && "bg-(--sidebar-item-active-bg) text-(--app-text)",
        className,
      )}
      data-active={isActive ? "true" : "false"}
      {...props}
    />
  );
}

/** The frame of a search box in a sidebar's top row. */
export const sidebarSearchClassName =
  "h-8 rounded-[6px] border border-transparent bg-transparent px-2 text-(--app-muted) focus-within:border-(--app-focus-ring) focus-within:bg-(--app-page-2) hover:bg-(--app-page-2) hover:text-(--app-text) [&>svg]:size-[15px]";
export const sidebarSearchInputClassName =
  "text-[13px] text-(--app-text) placeholder:text-[var(--app-placeholder,var(--app-muted))]";

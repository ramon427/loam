import { Slot } from "@radix-ui/react-slot";
import type { ComponentPropsWithoutRef } from "react";

import { fastUiTransitionClass } from "../styles/motion";
import { cn } from "./cn";

// Every row is 34px tall, with a rounded pill behind it on hover and when active. An app sets
// the text size with --sidebar-text-size (14px by default), to match its own sidebar.
const sidebarRowClassName = `flex h-[34px] w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[length:var(--sidebar-text-size,14px)] leading-5 text-[color:var(--sidebar-foreground,var(--app-muted))] transition-all ${fastUiTransitionClass} hover:bg-(--sidebar-item-hover-bg) hover:text-(--app-text) focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--app-border)/25 focus-visible:ring-offset-1 focus-visible:ring-offset-(--app-page) disabled:cursor-default disabled:opacity-50 [&>svg]:block [&>svg]:-translate-y-px`;

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
  "h-8 rounded-[9px] border border-(--app-border) bg-(--app-control) px-2.5 text-(--app-placeholder) focus-within:border-(--control-border-strong) hover:border-(--control-border-hover) [&>svg]:size-4";
export const sidebarSearchInputClassName =
  "text-[14px] text-(--app-text) placeholder:text-[var(--app-placeholder,var(--app-muted))]";

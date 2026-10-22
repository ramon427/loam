import { cn } from "../ui/cn";
import {
  DISABLED_CONTROL_CLASS,
  NESTED_FOCUS_RESET_CLASS,
  HIT_TARGET_CLASS,
} from "./controlInteraction";
import { controlSurfaceClass, controlSurfaceOpenClass, glassPanelClass } from "./controlSurface";

export const dropdownTriggerClass = cn(
  "group flex h-8 w-full cursor-pointer items-center justify-between gap-2 py-0 pl-3 pr-2.5 text-[13px] font-normal tracking-normal text-(--text) placeholder:text-(--app-muted)/70 outline-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  HIT_TARGET_CLASS,
  controlSurfaceClass,
  controlSurfaceOpenClass,
  NESTED_FOCUS_RESET_CLASS,
  DISABLED_CONTROL_CLASS,
);

/** The glass panel behind menus, selects and popovers. */
export const dropdownSurfaceClass = cn(glassPanelClass, "p-[5px]");

export const dropdownItemClass =
  "relative flex min-h-[30px] w-full cursor-pointer select-none items-center gap-[9px] rounded-[7px] px-2 py-1.5 text-[13px] leading-[18px] font-normal text-(--app-text) outline-hidden transition-[background-color,color] duration-120 ease-[cubic-bezier(0,0,0.2,1)] hover:bg-(--menu-item-hover-bg) focus-visible:bg-(--menu-item-hover-bg) data-highlighted:bg-(--menu-item-hover-bg) data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-(--app-disabled-opacity) data-inset:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[15px] [&_svg:not([class*='text-'])]:text-(--app-icon-muted)";

export const dropdownDestructiveItemClass =
  "data-[variant=destructive]:text-(--status-danger) data-[variant=destructive]:hover:bg-(--status-danger)/13 data-[variant=destructive]:focus-visible:bg-(--status-danger)/13 data-[variant=destructive]:data-highlighted:bg-(--status-danger)/13";

export const dropdownLabelClass =
  "px-2 pt-1.5 pb-1 text-[12px] leading-4 font-normal text-(--app-placeholder) data-inset:pl-8";

export const dropdownSeparatorClass = "mx-1 my-[5px] h-px bg-(--app-border)";

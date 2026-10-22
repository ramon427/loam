import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";

import { cn } from "./cn";
import { dropdownItemClass, dropdownSurfaceClass, dropdownTriggerClass } from "../styles/dropdowns";

const Select = SelectPrimitive.Root;

function SelectValue(props: React.ComponentPropsWithRef<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithRef<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(dropdownTriggerClass, className)}
      {...props}
    >
      <span className="inline-flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="min-w-0 truncate">{children}</span>
      </span>
      <ChevronDownIcon className="size-3.5 shrink-0 text-(--muted-text) transition-colors group-hover:text-(--text)" />
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithRef<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position="popper"
        className={cn(
          dropdownSurfaceClass,
          "relative z-50 max-h-(--radix-select-content-available-height) w-(--radix-select-trigger-width) min-w-0 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex cursor-default items-center justify-center py-1">
          <ChevronUpIcon className="size-4" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="h-(--radix-select-trigger-height) w-full min-w-0 scroll-my-1">
          {children}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex cursor-default items-center justify-center py-1">
          <ChevronDownIcon className="size-4" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithRef<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(dropdownItemClass, "aria-selected:bg-(--menu-item-hover-bg)", className)}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };

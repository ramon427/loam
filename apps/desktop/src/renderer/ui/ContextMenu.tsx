import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { ChevronRightIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "./cn";
import {
  dropdownDestructiveItemClass,
  dropdownItemClass,
  dropdownSeparatorClass,
  dropdownSurfaceClass,
} from "../styles/dropdowns";

function ContextMenu(props: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root {...props} />;
}

function ContextMenuTrigger(props: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />;
}

function ContextMenuPortal(props: React.ComponentProps<typeof ContextMenuPrimitive.Portal>) {
  return <ContextMenuPrimitive.Portal {...props} />;
}

function ContextMenuContent({
  className,
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPortal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        collisionPadding={collisionPadding}
        className={cn(
          dropdownSurfaceClass,
          "z-[80] max-h-[min(420px,var(--radix-context-menu-content-available-height))] min-w-32 origin-(--radix-context-menu-content-transform-origin) overflow-x-hidden overflow-y-auto outline-none",
          className,
        )}
        {...props}
      />
    </ContextMenuPortal>
  );
}

function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        dropdownItemClass,
        dropdownDestructiveItemClass,
        "data-disabled:opacity-45",
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn(dropdownSeparatorClass, className)}
      {...props}
    />
  );
}

function ContextMenuSub(props: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  return <ContextMenuPrimitive.Sub {...props} />;
}

function ContextMenuSubTrigger({
  className,
  inset,
  children,
  onPointerLeave,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & { inset?: boolean }) {
  return (
    <ContextMenuPrimitive.SubTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      className={cn(dropdownItemClass, "data-[state=open]:bg-(--menu-item-hover-bg)", className)}
      {...props}
      onPointerLeave={(event) => {
        onPointerLeave?.(event);
        const submenuId = event.currentTarget.getAttribute("aria-controls");
        const submenu = submenuId ? document.getElementById(submenuId) : null;
        // A direct move has already reached the submenu. Radix's directional
        // grace heuristic can otherwise focus the parent and close the submenu.
        if (event.relatedTarget instanceof Node && submenu?.contains(event.relatedTarget)) {
          event.preventDefault();
        }
      }}
    >
      {children}
      <ChevronRightIcon className="ml-4 size-3.5 shrink-0 text-(--muted-text)" />
    </ContextMenuPrimitive.SubTrigger>
  );
}

function ContextMenuSubContent({
  className,
  collisionPadding = 8,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPortal>
      <ContextMenuPrimitive.SubContent
        data-slot="context-menu-sub-content"
        collisionPadding={collisionPadding}
        sideOffset={sideOffset}
        className={cn(
          dropdownSurfaceClass,
          "z-[81] max-h-(--radix-context-menu-content-available-height) min-w-32 origin-(--radix-context-menu-content-transform-origin) overflow-x-hidden overflow-y-auto outline-none",
          className,
        )}
        {...props}
      />
    </ContextMenuPortal>
  );
}

export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
};

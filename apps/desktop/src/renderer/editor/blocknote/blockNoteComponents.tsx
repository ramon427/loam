import {
  createContext,
  useContext,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type ComponentPropsWithRef,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type MouseEventHandler,
  type PointerEvent,
  type PointerEventHandler,
} from "react";
import { createPortal } from "react-dom";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { blockTypeSelectItems, useBlockNoteEditor } from "@blocknote/react";
import { ShadCNDefaultComponents, type ShadCNComponents } from "@blocknote/shadcn";

import { cn } from "../../ui/cn";
import { Button } from "../../ui/Button";
import { DropdownMenuPortal } from "../../ui/DropdownMenu";
import { Input } from "../../ui/Input";
import { PopoverContent } from "../../ui/Popover";
import { dropdownItemClass, dropdownSurfaceClass } from "../../styles/dropdowns";
import { BlockPreviewCard } from "./BlockPreviewCard";
import { resolveBlockPreviewKind } from "./blockTypePreviewModel";

/*
 * BlockNote draws its menus, popovers and inputs with the shadcn components in
 * `shadCNComponents` below. These overrides give them the app's look and fix
 * behavior BlockNote's defaults get wrong for this app; anything not listed
 * falls back to BlockNote's own component.
 */

const defaults = ShadCNDefaultComponents;

// ---------------------------------------------------------------------------
// Dropdown menus (block menu, color pickers)

/**
 * Runs a menu item's action on pointerdown instead of click. BlockNote's
 * floating menus belong to editor state (selection, hovered block) that can
 * change between pointerdown and click and unmount the menu, losing the click.
 * The click that follows is skipped; a keyboard activation (Radix calls
 * `click()` on Enter, so `detail` is 0) always runs.
 */
function usePointerFirstAction<T extends HTMLElement>(
  onClick: MouseEventHandler<T> | undefined,
  onPointerDown: PointerEventHandler<T> | undefined,
) {
  const ranOnPointerDownRef = useRef(false);
  const handlePointerDown = (event: PointerEvent<T>) => {
    ranOnPointerDownRef.current = false;
    onPointerDown?.(event);
    if (event.defaultPrevented || event.button !== 0 || !onClick) return;
    ranOnPointerDownRef.current = true;
    onClick(event);
  };
  const handleClick = (event: MouseEvent<T>) => {
    const ranOnPointerDown = ranOnPointerDownRef.current;
    ranOnPointerDownRef.current = false;
    if (ranOnPointerDown && event.detail > 0) return;
    onClick?.(event);
  };
  return { onClick: handleClick, onPointerDown: handlePointerDown };
}

// BlockNote marks its color pickers only with this class name.
const isColorPickerMenu = (className: unknown) =>
  typeof className === "string" && className.includes("bn-color-picker-dropdown");

const colorPickerClass =
  "[&>[data-slot='dropdown-menu-label']]:px-1.5 [&>[data-slot='dropdown-menu-label']]:py-1 [&>[data-slot='dropdown-menu-label']]:text-[11px] [&>[data-slot='dropdown-menu-label']]:leading-4 [&>[data-slot='dropdown-menu-label']]:font-medium [&>[data-slot='dropdown-menu-label']]:text-(--app-muted)";

// Text and background colors side by side, ten rows each.
const colorPickerStyle: CSSProperties = {
  columnGap: "0.5rem",
  display: "grid",
  gridAutoFlow: "column",
  gridTemplateRows: "auto repeat(10, minmax(0, auto))",
  maxHeight: "min(760px, calc(100vh - 16px))",
  maxWidth: "calc(100vw - 24px)",
  minWidth: "320px",
  overflowX: "hidden",
  overflowY: "auto",
};

/** A top-level menu; the formatting toolbar's text color picker is one. */
function DropdownMenuContent({
  align,
  className,
  collisionPadding,
  side,
  sideOffset,
  style,
  ...props
}: ComponentProps<typeof defaults.DropdownMenu.DropdownMenuContent>) {
  const isColorPicker = isColorPickerMenu(className);
  return (
    <defaults.DropdownMenu.DropdownMenuContent
      className={cn(dropdownSurfaceClass, isColorPicker && colorPickerClass, className)}
      data-loam-color-menu={isColorPicker ? "true" : undefined}
      align={align ?? (isColorPicker ? "start" : undefined)}
      collisionPadding={collisionPadding ?? (isColorPicker ? 12 : undefined)}
      side={side ?? (isColorPicker ? "top" : undefined)}
      sideOffset={sideOffset ?? (isColorPicker ? 10 : undefined)}
      style={isColorPicker ? { ...style, ...colorPickerStyle } : style}
      {...props}
    />
  );
}

/** A submenu; the block menu's "Colors" picker is one. */
function DropdownMenuSubContent({
  className,
  collisionPadding,
  sideOffset,
  style,
  ...props
}: ComponentProps<typeof defaults.DropdownMenu.DropdownMenuSubContent>) {
  const isColorPicker = isColorPickerMenu(className);
  return (
    <DropdownMenuPortal>
      <defaults.DropdownMenu.DropdownMenuSubContent
        className={cn(dropdownSurfaceClass, "p-1.5", isColorPicker && colorPickerClass, className)}
        data-loam-block-color-menu={isColorPicker ? "true" : undefined}
        collisionPadding={collisionPadding ?? 12}
        sideOffset={sideOffset ?? 8}
        style={isColorPicker ? { ...style, ...colorPickerStyle } : style}
        {...props}
      />
    </DropdownMenuPortal>
  );
}

function DropdownMenuItem({
  className,
  onClick,
  onPointerDown,
  ...props
}: ComponentProps<typeof defaults.DropdownMenu.DropdownMenuItem>) {
  return (
    <defaults.DropdownMenu.DropdownMenuItem
      {...props}
      className={cn(dropdownItemClass, className)}
      {...usePointerFirstAction(onClick, onPointerDown)}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  onClick,
  onPointerDown,
  ...props
}: ComponentProps<typeof defaults.DropdownMenu.DropdownMenuCheckboxItem>) {
  return (
    <defaults.DropdownMenu.DropdownMenuCheckboxItem
      {...props}
      // BlockNote asks for its own row spacing; keep the app's menu rows instead.
      className={cn(dropdownItemClass, className, "gap-1.5 pl-7 pr-1.5")}
      {...usePointerFirstAction(onClick, onPointerDown)}
    />
  );
}

/** Opening a submenu must not move focus or the selection out of the editor. */
function DropdownMenuSubTrigger({
  className,
  onPointerDown,
  ...props
}: ComponentProps<typeof defaults.DropdownMenu.DropdownMenuSubTrigger>) {
  return (
    <defaults.DropdownMenu.DropdownMenuSubTrigger
      {...props}
      className={cn(dropdownItemClass, className)}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (!event.defaultPrevented && event.button === 0) event.preventDefault();
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Popovers (link editing, file panel)

function Popover(props: ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root {...props} />;
}

function PopoverContentForEditor({
  className,
  align = "center",
  sideOffset = 8,
  alignOffset = 12,
  collisionPadding = { left: 200, right: 24, top: 12, bottom: 12 },
  ...props
}: ComponentPropsWithRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverContent
      align={align}
      alignOffset={alignOffset}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn("bn-blocknote-popover", className)}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Tooltips

// BlockNote's Tooltip wraps every tooltip in its own zero-delay provider, which
// would override this shared 200 ms delay; the plain Radix root uses this one.
const TooltipProvider = ({
  delayDuration = 200,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) => (
  <TooltipPrimitive.Provider
    data-slot="tooltip-provider"
    delayDuration={delayDuration}
    {...props}
  />
);

const Tooltip = (props: ComponentProps<typeof TooltipPrimitive.Root>) => (
  <TooltipPrimitive.Root data-slot="tooltip" {...props} />
);

// A control with a tooltip here shows only this one, not the app's (ui/Tooltips.tsx) as well.
const TooltipTrigger = (props: ComponentProps<typeof TooltipPrimitive.Trigger>) => (
  <TooltipPrimitive.Trigger data-slot="tooltip-trigger" data-no-tooltip="" {...props} />
);

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: ComponentPropsWithRef<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "bn-tooltip-content z-[10080] max-w-[220px] rounded-md border border-(--app-border)/40 bg-(--app-text) px-2.5 py-1.5 text-xs font-medium text-(--app-page) shadow-(--shadow-elevated)",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="bg-(--app-text) fill-(--app-text) size-2 -translate-y-[calc(50%_+_2px)] rotate-45 rounded-sm" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

// ---------------------------------------------------------------------------
// Inputs

/** BlockNote's forms leave these fields unlabeled; they get an accessible name. */
function BlockNoteInput(props: ComponentPropsWithRef<typeof Input> & { "data-test"?: string }) {
  let fallbackLabel: string | undefined;
  if (props["data-test"] === "embed-input") fallbackLabel = "File URL";
  else if (props.name === "url") fallbackLabel = "Link URL";
  else if (props.name === "title") fallbackLabel = "Link text";
  else if (props.type === "file") fallbackLabel = props.placeholder;
  const label = props["aria-label"] ?? (props["aria-labelledby"] ? undefined : fallbackLabel);
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    try {
      props.onChange?.(event);
    } finally {
      // Browsers otherwise suppress change when a failed file is selected again.
      input.value = "";
    }
  };
  return (
    <Input
      {...props}
      aria-label={label}
      onChange={props.type === "file" ? handleFileChange : props.onChange}
    />
  );
}

// ---------------------------------------------------------------------------
// Select (the formatting toolbar's block-type menu)

// BlockNote renders its block-type select with this class name.
const isBlockTypeSelectMenu = (className: unknown) =>
  typeof className === "string" && className.includes("bn-select");

type HighlightedBlockType = { name: string; left: number; top: number };

const HighlightBlockTypeContext = createContext<(item: HighlightedBlockType | null) => void>(
  () => {},
);

const previewCardWidth = 252;
const previewGap = 12;

/** Beside the menu (left when there's room), level with the highlighted item. */
const placePreview = (item: HTMLElement, name: string): HighlightedBlockType => {
  const menuRect = (item.closest("[data-loam-block-type-menu]") ?? item).getBoundingClientRect();
  const left = menuRect.left - previewGap - previewCardWidth;
  return {
    name,
    left: left >= previewGap ? left : menuRect.right + previewGap,
    top: Math.max(previewGap, item.getBoundingClientRect().top - 8),
  };
};

function BlockTypePreview({ highlighted }: { highlighted: HighlightedBlockType }) {
  const editor = useBlockNoteEditor();
  const item = blockTypeSelectItems(editor.dictionary).find(
    (candidate) => candidate.name === highlighted.name,
  );
  if (!item) return null;
  return createPortal(
    <BlockPreviewCard
      kind={resolveBlockPreviewKind(item.type, item.props)}
      title={item.name}
      placement={{ left: highlighted.left, top: highlighted.top }}
    />,
    document.body,
  );
}

/** Shows a sample of the highlighted block type beside the block-type menu. */
function SelectContent({
  align,
  className,
  collisionBoundary,
  collisionPadding,
  position,
  side,
  sideOffset,
  style,
  ...props
}: ComponentProps<typeof defaults.Select.SelectContent>) {
  const isBlockTypeMenu = isBlockTypeSelectMenu(className);
  const [highlighted, setHighlighted] = useState<HighlightedBlockType | null>(null);
  return (
    <HighlightBlockTypeContext value={isBlockTypeMenu ? setHighlighted : () => {}}>
      <defaults.Select.SelectContent
        className={cn(
          dropdownSurfaceClass,
          // BlockNote merges with an older tailwind-merge that keeps its own
          // rounded-md and shadow-md beside these.
          "rounded-(--radius-menu)! shadow-(--raised-panel-shadow)!",
          "max-h-[min(420px,calc(100vh-24px))] w-(--radix-select-trigger-width) min-w-0",
          className,
        )}
        data-loam-block-type-menu={isBlockTypeMenu ? "true" : undefined}
        align={align ?? (isBlockTypeMenu ? "start" : undefined)}
        collisionBoundary={
          collisionBoundary ??
          (isBlockTypeMenu ? (document.querySelector("main") ?? undefined) : undefined)
        }
        collisionPadding={collisionPadding ?? (isBlockTypeMenu ? 12 : undefined)}
        position={isBlockTypeMenu ? "popper" : position}
        side={side ?? (isBlockTypeMenu ? "left" : undefined)}
        sideOffset={sideOffset ?? (isBlockTypeMenu ? 8 : undefined)}
        style={isBlockTypeMenu ? { ...style, zIndex: 10090 } : style}
        onPointerLeave={() => setHighlighted(null)}
        {...props}
      />
      {highlighted ? <BlockTypePreview highlighted={highlighted} /> : null}
    </HighlightBlockTypeContext>
  );
}

function SelectItem({
  className,
  value,
  ...props
}: ComponentProps<typeof defaults.Select.SelectItem>) {
  const highlight = useContext(HighlightBlockTypeContext);
  // Radix focuses the highlighted item for both pointer and keyboard navigation.
  const handleFocus = (event: FocusEvent<HTMLDivElement>) =>
    highlight(placePreview(event.currentTarget, value));
  return (
    <defaults.Select.SelectItem
      className={cn(
        dropdownItemClass,
        "aria-selected:bg-(--menu-item-hover-bg) [&_svg:not([class*='text-'])]:text-current *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      value={value}
      onFocus={handleFocus}
      {...props}
    />
  );
}

/** The `shadCNComponents` passed to BlockNoteView. */
export const blockNoteComponents = {
  Button: { Button },
  DropdownMenu: {
    ...defaults.DropdownMenu,
    DropdownMenuContent,
    DropdownMenuSubContent,
    DropdownMenuItem,
    DropdownMenuCheckboxItem,
    DropdownMenuSubTrigger,
  },
  Input: { Input: BlockNoteInput },
  Popover: {
    ...defaults.Popover,
    Popover,
    PopoverContent: PopoverContentForEditor,
  },
  Select: { ...defaults.Select, SelectContent, SelectItem },
  Tooltip: { ...defaults.Tooltip, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger },
} satisfies Partial<ShadCNComponents>;

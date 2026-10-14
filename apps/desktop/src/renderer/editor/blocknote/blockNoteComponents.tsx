import {
  Children,
  createContext,
  isValidElement,
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
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Slot } from "@radix-ui/react-slot";
import { blockTypeSelectItems, useBlockNoteEditor } from "@blocknote/react";
import { ShadCNDefaultComponents, type ShadCNComponents } from "@blocknote/shadcn";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "../../ui/cn";
import { Button } from "../../ui/Button";
import {
  DropdownMenuCheckboxItem as AppDropdownMenuCheckboxItem,
  DropdownMenuItem as AppDropdownMenuItem,
  DropdownMenuLabel as AppDropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator as AppDropdownMenuSeparator,
} from "../../ui/DropdownMenu";
import { Input } from "../../ui/Input";
import { PopoverContent } from "../../ui/Popover";
import { SelectContent as AppSelectContent, SelectItem as AppSelectItem } from "../../ui/Select";
import { dropdownItemClass, dropdownSurfaceClass } from "../../styles/dropdowns";
import { BlockPreviewCard } from "./BlockPreviewCard";
import { resolveBlockPreviewKind } from "./blockTypePreviewModel";

/*
 * BlockNote draws its menus, popovers and inputs with the shadcn components in
 * `shadCNComponents` below. These overrides draw them with the app's own
 * components, so the editor's menus look and behave like the rest of the
 * window, and fix behavior BlockNote's defaults get wrong for this app;
 * anything not listed falls back to BlockNote's own component.
 */

const defaults = ShadCNDefaultComponents;

/**
 * Only BlockNote's own `bn-` class names, which name a menu or field. The
 * spacing classes it asks for beside them would undo the app's.
 */
const blockNoteNames = (className: string | undefined) =>
  className
    ?.split(/\s+/)
    .filter((name) => name.startsWith("bn-"))
    .join(" ");

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

const menuContentClass =
  "z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto outline-none";

/**
 * A top-level menu; the formatting toolbar's text color picker is one. It
 * stays inside the editor, where BlockNote places it, rather than in a portal.
 */
function DropdownMenuContent({
  align,
  className,
  collisionPadding,
  side,
  sideOffset,
  style,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  const isColorPicker = isColorPickerMenu(className);
  return (
    <DropdownMenuPrimitive.Content
      data-slot="dropdown-menu-content"
      className={cn(dropdownSurfaceClass, menuContentClass, blockNoteNames(className))}
      data-loam-color-menu={isColorPicker ? "true" : undefined}
      align={align ?? (isColorPicker ? "start" : undefined)}
      collisionPadding={collisionPadding ?? (isColorPicker ? 12 : undefined)}
      side={side ?? (isColorPicker ? "top" : undefined)}
      sideOffset={sideOffset ?? (isColorPicker ? 10 : 8)}
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
}: ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  const isColorPicker = isColorPickerMenu(className);
  return (
    <DropdownMenuPortal>
      <DropdownMenuPrimitive.SubContent
        data-slot="dropdown-menu-sub-content"
        className={cn(dropdownSurfaceClass, menuContentClass, blockNoteNames(className))}
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
}: ComponentProps<typeof AppDropdownMenuItem>) {
  return (
    <AppDropdownMenuItem
      {...props}
      className={blockNoteNames(className)}
      {...usePointerFirstAction(onClick, onPointerDown)}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  onClick,
  onPointerDown,
  ...props
}: ComponentProps<typeof AppDropdownMenuCheckboxItem>) {
  return (
    <AppDropdownMenuCheckboxItem
      {...props}
      className={blockNoteNames(className)}
      {...usePointerFirstAction(onClick, onPointerDown)}
    />
  );
}

/** Opening a submenu must not move focus or the selection out of the editor. */
function DropdownMenuSubTrigger({
  className,
  children,
  onPointerDown,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      {...props}
      className={cn(
        dropdownItemClass,
        "data-[state=open]:bg-(--menu-item-hover-bg)",
        blockNoteNames(className),
      )}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (!event.defaultPrevented && event.button === 0) event.preventDefault();
      }}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-3.5 shrink-0 text-(--muted-text)" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

const DropdownMenuLabel = ({
  className,
  ...props
}: ComponentProps<typeof AppDropdownMenuLabel>) => (
  <AppDropdownMenuLabel className={blockNoteNames(className)} {...props} />
);

const DropdownMenuSeparator = ({
  className,
  ...props
}: ComponentProps<typeof AppDropdownMenuSeparator>) => (
  <AppDropdownMenuSeparator className={blockNoteNames(className)} {...props} />
);

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

/*
 * BlockNote's tooltips show through the app's own tooltip layer
 * (ui/Tooltips.tsx), so they look and time like every other tooltip: the
 * trigger carries the text as `data-tooltip` and nothing else is drawn.
 */

const TooltipTextContext = createContext<string | undefined>(undefined);

/** The text in a piece of tooltip content. */
const textOf = (node: ReactNode): string =>
  Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (isValidElement<{ children?: ReactNode }>(child)) return textOf(child.props.children);
      return "";
    })
    .join("");

/** BlockNote's own provider would set its own delay; the app's layer has one. */
const TooltipProvider = ({ children }: ComponentProps<typeof defaults.Tooltip.TooltipProvider>) => (
  <>{children}</>
);

/**
 * BlockNote puts a control's name in the tooltip, then its shortcut if it has
 * one; the app writes that as "Bold (Ctrl+B)".
 */
function Tooltip({ children }: ComponentProps<typeof defaults.Tooltip.Tooltip>) {
  const content = Children.toArray(children).find(
    (child) => isValidElement<{ children?: ReactNode }>(child) && child.type === TooltipContent,
  );
  const [name, shortcut] = isValidElement<{ children?: ReactNode }>(content)
    ? Children.toArray(content.props.children).map(textOf).filter(Boolean)
    : [];
  const text = name && shortcut ? `${name} (${shortcut})` : name;
  return <TooltipTextContext value={text}>{children}</TooltipTextContext>;
}

/** BlockNote always passes `asChild`: the trigger is the control itself. */
function TooltipTrigger({
  asChild: _asChild,
  ...props
}: ComponentProps<typeof defaults.Tooltip.TooltipTrigger>) {
  return <Slot data-tooltip={useContext(TooltipTextContext)} {...props} />;
}

/** Read by `Tooltip`; the app's tooltip layer draws it. */
function TooltipContent(_props: ComponentProps<typeof defaults.Tooltip.TooltipContent>) {
  return <></>;
}

// ---------------------------------------------------------------------------
// Inputs

/**
 * BlockNote's forms leave these fields unlabeled; they get an accessible name.
 * Its `bn-text-input` field draws its own frame around the input, so the
 * input itself is drawn without one.
 */
function BlockNoteInput(props: ComponentPropsWithRef<typeof Input> & { "data-test"?: string }) {
  let fallbackLabel: string | undefined;
  if (props["data-test"] === "embed-input") fallbackLabel = "File URL";
  else if (props.name === "url") fallbackLabel = "Link URL";
  else if (props.name === "title") fallbackLabel = "Link text";
  else if (props.type === "file") fallbackLabel = props.placeholder;
  const label = props["aria-label"] ?? (props["aria-labelledby"] ? undefined : fallbackLabel);
  const inField = props.className?.includes("bn-text-input") ?? false;
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
      className={inField ? cn("bn-text-input", "h-auto px-0 py-0") : props.className}
      surface={inField ? "plain" : props.surface}
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

/**
 * The app's select menu, as wide as its longest item so no name wraps, with a
 * sample of the highlighted block type beside it.
 */
function SelectContent({
  align,
  className,
  collisionBoundary,
  collisionPadding,
  side,
  sideOffset,
  style,
  ...props
}: ComponentProps<typeof AppSelectContent>) {
  const isBlockTypeMenu = isBlockTypeSelectMenu(className);
  const [highlighted, setHighlighted] = useState<HighlightedBlockType | null>(null);
  return (
    <HighlightBlockTypeContext value={isBlockTypeMenu ? setHighlighted : () => {}}>
      <AppSelectContent
        className={cn(
          "max-h-[min(420px,calc(100vh-24px))] w-max min-w-(--radix-select-trigger-width)",
          blockNoteNames(className),
        )}
        data-loam-block-type-menu={isBlockTypeMenu ? "true" : undefined}
        align={align ?? (isBlockTypeMenu ? "start" : undefined)}
        collisionBoundary={
          collisionBoundary ??
          (isBlockTypeMenu ? (document.querySelector("main") ?? undefined) : undefined)
        }
        collisionPadding={collisionPadding ?? (isBlockTypeMenu ? 12 : undefined)}
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

/** The current block type is marked by its highlight, as in the app's other selects. */
function SelectItem({ className, value, ...props }: ComponentProps<typeof AppSelectItem>) {
  const highlight = useContext(HighlightBlockTypeContext);
  // Radix focuses the highlighted item for both pointer and keyboard navigation.
  const handleFocus = (event: FocusEvent<HTMLDivElement>) =>
    highlight(placePreview(event.currentTarget, value));
  return (
    <AppSelectItem
      className={cn(
        "whitespace-nowrap *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        blockNoteNames(className),
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
    DropdownMenuLabel,
    DropdownMenuSeparator,
  },
  Input: { Input: BlockNoteInput },
  Popover: {
    ...defaults.Popover,
    Popover,
    PopoverContent: PopoverContentForEditor,
  },
  Select: { ...defaults.Select, SelectContent, SelectItem },
  Tooltip: { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger },
} satisfies Partial<ShadCNComponents>;

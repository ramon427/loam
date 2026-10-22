import {
  createContext,
  use,
  useRef,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "../ui/ContextMenu";
import {
  ariaKeyShortcut,
  formatShortcut,
  isEditableTarget,
  type ShortcutId,
} from "../keyboard/shortcuts";

/*
 * A feature's right-click menu is a Radix `ContextMenu` from ui/ContextMenu with these
 * pieces inside. Right-clicks no feature menu takes (text fields, links, images) get the
 * native menu from the main process (main/contextMenu.ts).
 */

const RunAfterCloseContext = createContext<(action: () => void) => void>((action) => action());

/**
 * The open menu. An item's action runs once the menu has closed and handed focus back, so the
 * action can move focus itself (into a rename field or a dialog) without losing it.
 */
export function ActionMenuContent({
  children,
  ...props
}: Omit<ComponentProps<typeof ContextMenuContent>, "onCloseAutoFocus" | "onContextMenu">) {
  const pending = useRef<(() => void) | null>(null);
  return (
    <RunAfterCloseContext
      value={(action) => {
        pending.current = action;
      }}
    >
      <ContextMenuContent
        {...props}
        onCloseAutoFocus={() => {
          const action = pending.current;
          pending.current = null;
          if (action) queueMicrotask(action);
        }}
        // A right-click inside the open menu neither reopens it nor shows the native menu.
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {children}
      </ContextMenuContent>
    </RunAfterCloseContext>
  );
}

export function ActionMenuItem({
  icon,
  shortcut,
  destructive = false,
  disabled,
  onSelect,
  children,
}: {
  icon?: ReactNode;
  /** The keys that do the same, shown after the label and announced after the item's name. */
  shortcut?: ShortcutId;
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  const runAfterClose = use(RunAfterCloseContext);
  return (
    <ContextMenuItem
      disabled={disabled}
      variant={destructive ? "destructive" : "default"}
      aria-keyshortcuts={shortcut && ariaKeyShortcut(shortcut)}
      onSelect={() => runAfterClose(onSelect)}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{children}</span>
      {shortcut ? (
        <span aria-hidden="true" className="ml-4 text-xs text-(--app-muted)">
          {formatShortcut(shortcut)}
        </span>
      ) : null}
    </ContextMenuItem>
  );
}

export function ActionMenuSub({
  label,
  icon,
  disabled,
  children,
}: {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger disabled={disabled}>
        {icon}
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>{children}</ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/**
 * Leaves a right-click to the native menu, from a menu trigger's `onContextMenuCapture`.
 * Stopping the event there keeps Radix's trigger from seeing it, so the trigger neither opens
 * its menu nor cancels the browser's.
 */
export function leaveToNativeMenu(event: MouseEvent) {
  event.stopPropagation();
}

/**
 * Whether a right-click, seen by a menu trigger, is one its menu should take: on the trigger's
 * own elements (not in a dialog or menu portaled from inside it, which React still bubbles
 * there) and not in a text field, which gets the native Cut/Copy/Paste menu.
 */
export const isActionMenuTarget = (event: MouseEvent) =>
  event.target instanceof Element &&
  event.currentTarget.contains(event.target) &&
  !isEditableTarget(event.target);

/**
 * The items a right-click on `targetId` acts on: the whole selection when the target is in it,
 * else the target alone (as in a file manager).
 */
export const snapshotContextSelection = <T extends string>(
  selection: ReadonlySet<T>,
  targetId?: T,
): { ids: readonly T[] } => ({
  ids: targetId && !selection.has(targetId) ? [targetId] : [...selection],
});

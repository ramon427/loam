import { useEffect, type ReactNode, type Ref } from "react";
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";

import { AiChatOpenButton } from "../ai/AiChatPanel";
import { callBridge } from "../bridge";
import { ShortcutHint } from "../keyboard/ShortcutHint";
import { resolveTheme, subscribeToThemeChanges } from "../lib/theme";
import { Button } from "../ui/Button";

/*
 * The window has no separate title bar. Its top row is the sidebar's first
 * row and each screen's header, and it is the window's drag area. Native
 * minimize, maximize and close buttons are drawn over its right end on
 * Windows and Linux, and the traffic lights over its left end on macOS; the
 * styles keep that space clear.
 */

/**
 * Paints the native window buttons (Windows and Linux) in the window's
 * colors, and gives the window its glass, now and whenever the theme changes.
 */
export function useWindowControlsTheme() {
  useEffect(() => {
    // Chromium resolves every theme color, OKLCH included, to sRGB for the
    // native buttons; a canvas reads back what it would paint.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const toHex = (color: string) => {
      if (!context || !color) return undefined;
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return `#${Array.from(context.getImageData(0, 0, 1, 1).data)
        .slice(0, 3)
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("")}`;
    };
    const syncTheme = () => {
      const style = getComputedStyle(document.documentElement);
      const color = toHex(style.getPropertyValue("--app-bg").trim());
      const symbolColor = toHex(
        style.getPropertyValue("--app-secondary-label").trim() ||
          style.getPropertyValue("--app-muted").trim(),
      );
      void callBridge("app.setTheme", {
        theme: resolveTheme(),
        colors: color && symbolColor ? { color, symbolColor } : undefined,
        glass: document.documentElement.dataset.glass === "full",
      }).catch((error: unknown) => {
        console.warn("Could not update the window theme.", error);
      });
    };
    syncTheme();
    return subscribeToThemeChanges(syncTheme);
  }, []);
}

/**
 * Shows or hides the sidebar. It stays at the window's top-left corner, over
 * the sidebar's first row or, with the sidebar hidden, the screen's header.
 */
export function SidebarToggle({
  expanded,
  onToggle,
  ref,
}: {
  expanded: boolean;
  onToggle: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const label = expanded ? "Collapse sidebar" : "Expand sidebar";
  return (
    <div className="loam-sidebar-toggle">
      <ShortcutHint label={label} shortcut="app.sidebar.toggle">
        <Button
          ref={ref}
          type="button"
          variant="ghost-muted"
          size="icon-sm"
          aria-label={label}
          aria-expanded={expanded}
          aria-controls="notes-sidebar"
          onClick={onToggle}
        >
          {expanded ? (
            <PanelLeftCloseIcon className="size-4" aria-hidden="true" />
          ) : (
            <PanelLeftOpenIcon className="size-4" aria-hidden="true" />
          )}
        </Button>
      </ShortcutHint>
    </div>
  );
}

/**
 * Keeps a top row's drag area from under the sidebar toggle. Electron applies drag and no-drag
 * areas in page order, so a row that comes after the toggle would take its clicks as window
 * drags; this no-drag area is inside the row, after the row's own drag area.
 */
export function SidebarToggleSlot() {
  return <span className="loam-sidebar-toggle-slot" />;
}

/** The top row of the main column: the screen's title and actions, on the window's drag area. */
export function MainHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="loam-chrome-row loam-main-header">
      <SidebarToggleSlot />
      {children}
      <span className="ml-auto flex empty:hidden">
        <AiChatOpenButton />
      </span>
    </header>
  );
}

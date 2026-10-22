import { createContext, use, useLayoutEffect, useRef, type ReactNode } from "react";

import {
  isEditableTarget,
  matchesShortcut,
  shortcuts,
  type ShortcutCombo,
  type ShortcutId,
} from "./shortcuts";

export type Shortcut = {
  /** One of the app's shortcuts, or a plugin command's, which gives its own `combo`. */
  id: ShortcutId | `plugin:${string}`;
  combo?: ShortcutCombo;
  run: () => void;
  enabled?: boolean;
  /** Also runs while typing in a text field or the editor. */
  allowInEditable?: boolean;
};

type Registration = { current: Shortcut[] };

const registrations = new Set<Registration>();
/** Escape right after Alt/Cmd+Tab dismisses the system app switcher, not something in the app. */
const APP_SWITCH_ESCAPE_GRACE_MS = 1_200;
let appSwitchEscapeUntil = 0;

/** Keys pressed inside a dialog, menu or list popup belong to it. */
const isInsideOverlay = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(target.closest("[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox']"));

/**
 * Something on the way already used the key. ProseMirror (the note editor) cancels every
 * Escape keydown, used or not, so that doesn't count as handled there.
 */
const isHandled = (event: KeyboardEvent) =>
  event.defaultPrevented &&
  !(
    event.key === "Escape" &&
    event.target instanceof Element &&
    event.target.closest(".ProseMirror")
  );

/** The shortcut `event` should run: the latest registered one that is enabled and matches. */
function findShortcut(event: KeyboardEvent, candidates: readonly Shortcut[]) {
  if (isHandled(event) || isInsideOverlay(event.target)) return null;
  const editable = isEditableTarget(event.target);
  for (let index = candidates.length - 1; index >= 0; index--) {
    const shortcut = candidates[index]!;
    if (shortcut.enabled === false || (editable && !shortcut.allowInEditable)) continue;
    const combo = shortcut.combo ?? shortcuts[shortcut.id as ShortcutId];
    if (combo && matchesShortcut(event, combo)) return shortcut;
  }
  return null;
}

/**
 * Runs in the bubble phase, after the focused component and Radix overlays have had the key:
 * anything that handled it (and called `preventDefault`) wins over an app shortcut. A canvas
 * like the graph handles its own keys this way, in its `onKeyDown`.
 */
const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === "Tab" && (event.altKey || event.metaKey)) {
    appSwitchEscapeUntil = Date.now() + APP_SWITCH_ESCAPE_GRACE_MS;
    return;
  }
  if (event.key === "Escape" && Date.now() < appSwitchEscapeUntil) return;
  const shortcut = findShortcut(
    event,
    [...registrations].flatMap((registration) => registration.current),
  );
  if (!shortcut) return;
  event.preventDefault();
  shortcut.run();
};

const ShortcutsEnabledContext = createContext(true);

/** Turns off the shortcuts registered inside, e.g. for a workspace hidden behind settings. */
export function KeyboardShortcutsScope({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const parentEnabled = use(ShortcutsEnabledContext);
  return (
    <ShortcutsEnabledContext value={parentEnabled && enabled}>{children}</ShortcutsEnabledContext>
  );
}

/** Runs `list`'s shortcuts while the component is mounted. */
export function useShortcuts(list: Shortcut[]) {
  const enabled = use(ShortcutsEnabledContext);
  const registration = useRef<Shortcut[]>([]);
  useLayoutEffect(() => {
    registration.current = enabled ? list : [];
  });
  useLayoutEffect(() => {
    if (registrations.size === 0) window.addEventListener("keydown", handleKeyDown);
    registrations.add(registration);
    return () => {
      registrations.delete(registration);
      if (registrations.size === 0) window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}

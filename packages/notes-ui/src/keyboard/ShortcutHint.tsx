import { cloneElement, type ReactElement } from "react";

import { ariaKeyShortcut, formatShortcut, type ShortcutId } from "./shortcuts";

/**
 * Names a control's shortcut: the native tooltip reads "Label (Ctrl+B)", and the control
 * gets `aria-keyshortcuts` for screen readers.
 */
export function ShortcutHint({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut: ShortcutId;
  children: ReactElement<{ "aria-keyshortcuts"?: string }>;
}) {
  return (
    <span className="inline-flex" title={`${label} (${formatShortcut(shortcut)})`}>
      {cloneElement(children, { "aria-keyshortcuts": ariaKeyShortcut(shortcut) })}
    </span>
  );
}

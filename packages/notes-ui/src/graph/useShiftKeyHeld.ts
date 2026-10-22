/**
 * Tracks whether the Shift key is currently held, with one module-level set of
 * window listeners shared by every subscriber. Used for transient modifier
 * behavior (e.g. aspect-ratio lock while resizing) where a keydown handler is
 * the wrong tool because the gesture is already in progress.
 */

import { useSyncExternalStore } from "react";

let shiftHeld = false;
const listeners = new Set<() => void>();

const emit = () => {
  listeners.forEach((listener) => listener());
};

const setShiftHeld = (next: boolean) => {
  if (shiftHeld === next) return;
  shiftHeld = next;
  emit();
};

const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === "Shift") setShiftHeld(true);
};

const handleKeyUp = (event: KeyboardEvent) => {
  if (event.key === "Shift") setShiftHeld(false);
};

// Releasing Shift while the window is unfocused must not leave a stuck true.
const handleWindowBlur = () => setShiftHeld(false);

const subscribe = (listener: () => void) => {
  if (listeners.size === 0) {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    }
  };
};

export function useShiftKeyHeld() {
  return useSyncExternalStore(subscribe, () => shiftHeld);
}

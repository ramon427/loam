import { useSyncExternalStore } from "react";

import { configuredNotesHost } from "../host/notesHost";
import { readPreference, writePreference } from "../lib/preferences";

const CANVAS_BACKGROUND_KEY = "canvas-background:v1";

export const canvasBackgrounds = ["grid", "dots", "plain"] as const;
export type CanvasBackground = (typeof canvasBackgrounds)[number];

const isCanvasBackground = (value: unknown): value is CanvasBackground =>
  canvasBackgrounds.includes(value as CanvasBackground);

// Read when a note first shows, after the host is set, so the host's default applies.
let current: CanvasBackground | undefined;
const readCurrent = () =>
  (current ??=
    readPreference(CANVAS_BACKGROUND_KEY, (saved) => (isCanvasBackground(saved) ? saved : null)) ??
    configuredNotesHost()?.canvasBackground ??
    "grid");
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const setCanvasBackground = (next: CanvasBackground) => {
  current = next;
  writePreference(CANVAS_BACKGROUND_KEY, next);
  for (const listener of listeners) listener();
};

/** The pattern behind the note's paper, shared by every open note. */
export function useCanvasBackground() {
  const background = useSyncExternalStore(subscribe, readCurrent);
  return [background, setCanvasBackground] as const;
}

import { useSyncExternalStore } from "react";

import { readPreference, writePreference } from "../lib/preferences";

const CANVAS_BACKGROUND_KEY = "canvas-background:v1";

export const canvasBackgrounds = ["grid", "dots", "plain"] as const;
export type CanvasBackground = (typeof canvasBackgrounds)[number];

const isCanvasBackground = (value: unknown): value is CanvasBackground =>
  canvasBackgrounds.includes(value as CanvasBackground);

let current: CanvasBackground =
  readPreference(CANVAS_BACKGROUND_KEY, (saved) => (isCanvasBackground(saved) ? saved : null)) ??
  "grid";
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
  const background = useSyncExternalStore(subscribe, () => current);
  return [background, setCanvasBackground] as const;
}

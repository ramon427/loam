import { readFileSync, writeFileSync } from "node:fs";

type Bounds = { x?: number; y?: number; width: number; height: number };
type Display = { workArea: { x: number; y: number; width: number; height: number } };

export const MIN_WINDOW_WIDTH = 480;
export const MIN_WINDOW_HEIGHT = 480;
const DEFAULT_BOUNDS: Bounds = { width: 1280, height: 840 };

const isFiniteBounds = (value: unknown): value is Required<Bounds> =>
  Boolean(value) &&
  ["x", "y", "width", "height"].every((key) =>
    Number.isFinite((value as Record<string, number>)[key]),
  );

/** Restores the last bounds only when they still overlap a connected display. */
const clampWindowBounds = (saved: unknown, displays: Display[]): Bounds => {
  if (!isFiniteBounds(saved)) return { ...DEFAULT_BOUNDS };
  const display = displays.find(
    ({ workArea: area }) =>
      saved.x < area.x + area.width &&
      saved.x + saved.width > area.x &&
      saved.y < area.y + area.height &&
      saved.y + saved.height > area.y,
  );
  if (!display) return { ...DEFAULT_BOUNDS };
  const area = display.workArea;
  const width = Math.min(Math.max(saved.width, MIN_WINDOW_WIDTH), area.width);
  const height = Math.min(Math.max(saved.height, MIN_WINDOW_HEIGHT), area.height);
  return {
    x: Math.min(Math.max(saved.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(saved.y, area.y), area.y + area.height - height),
    width,
    height,
  };
};

export const readWindowBounds = (path: string, displays: Display[]) => {
  try {
    return clampWindowBounds(JSON.parse(readFileSync(path, "utf8")), displays);
  } catch {
    return { ...DEFAULT_BOUNDS };
  }
};

export const writeWindowBounds = (path: string, bounds: Bounds) => {
  try {
    writeFileSync(path, `${JSON.stringify(bounds)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Window placement is a convenience; failing to save it must not block quitting.
  }
};

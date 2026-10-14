import { noteGraphNodeColors } from "./noteGraphColors";
import type { NoteProjectColor, NoteProjectIcon } from "./noteModel";

export const MAX_PROJECT_NAME_LENGTH = 120;

/**
 * The line icons a project can show. Notes store these names, so they don't change; the
 * window maps each to its drawing.
 */
export const NOTE_PROJECT_SYMBOLS = [
  "box",
  "briefcase",
  "book",
  "lightbulb",
  "code",
  "rocket",
  "star",
  "heart",
  "home",
  "school",
  "flask",
  "palette",
  "music",
  "camera",
  "plane",
  "globe",
  "chart",
  "calendar",
  "target",
  "flag",
  "leaf",
  "coffee",
  "wrench",
  "pencil",
  "users",
  "lock",
  "moon",
  "sun",
  "bolt",
  "puzzle",
  "gamepad",
  "terminal",
] as const;

export type NoteProjectSymbol = (typeof NOTE_PROJECT_SYMBOLS)[number];

const SYMBOLS: ReadonlySet<string> = new Set(NOTE_PROJECT_SYMBOLS);
const COLORS: ReadonlySet<string> = new Set(noteGraphNodeColors);
// Exactly one emoji, such as a flag, a keycap or a family; never free text. (A regex literal
// can't use the `v` flag at this TypeScript target.)
const ONE_EMOJI = new RegExp("^\\p{RGI_Emoji}$", "v");

/** A stored or received icon, kept only when it is one the app can draw. */
export const readNoteProjectIcon = (value: unknown): NoteProjectIcon | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { kind, value: name, color } = value as Record<string, unknown>;
  if (kind === "emoji")
    return typeof name === "string" && ONE_EMOJI.test(name) ? { kind, value: name } : undefined;
  if (kind !== "symbol" || typeof name !== "string" || !SYMBOLS.has(name)) return undefined;
  return typeof color === "string" && COLORS.has(color)
    ? { kind, value: name, color: color as NoteProjectColor }
    : { kind, value: name };
};

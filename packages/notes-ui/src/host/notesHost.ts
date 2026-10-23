import type {
  LoamBridgeEvent,
  LoamBridgeEvents,
  LoamBridgeMethod,
  LoamBridgeParams,
  LoamBridgeResult,
  BridgeResult,
} from "@loam/shared/bridge/loamBridge";

import type { CanvasBackground } from "../note/useCanvasBackground";

/** The bridge methods the notes screens call: the library, media and files. */
export type NotesHostMethod = Extract<
  LoamBridgeMethod,
  `notes.${string}` | `media.${string}` | `files.${string}`
>;

/** The events the notes screens listen to. */
export type NotesHostEvent = Extract<LoamBridgeEvent, `notes.${string}` | `files.${string}`>;

/**
 * Where the notes screens read and save. Loam's window passes `window.loam`; an app that
 * embeds the notes passes its own, backed by its storage. Each method answers like
 * `window.loam.invoke`: `{ ok: true, data }` or `{ ok: false, error }`.
 */
export type NotesHost = {
  invoke<M extends NotesHostMethod>(
    method: M,
    params: LoamBridgeParams<M>,
  ): Promise<BridgeResult<LoamBridgeResult<M>>>;
  on<E extends NotesHostEvent>(
    event: E,
    listener: (payload: LoamBridgeEvents[E]) => void,
  ): () => void;
  /** Where a file dropped on the window is on this computer; empty when it isn't a file there. */
  pathForFile?(file: File): string;
  /** The URL an `<img>` loads for a stored image path; Loam's own is `loam-media://images/<path>`. */
  mediaUrl?(path: string): string;
  /**
   * The stored image path behind a reference in this host's own form (its own URL scheme,
   * say), or null for references it doesn't recognize. Paths it returns go to `mediaUrl`.
   */
  mediaPath?(reference: string): string | null;
  /** What this host can do; screens for what it can't are hidden. Everything is on by default. */
  capabilities?: Partial<NotesCapabilities>;
  /** The pattern behind a note's paper until someone picks one; graph paper by default. */
  canvasBackground?: CanvasBackground;
  /** Where the screens keep their preferences; the window's localStorage by default. */
  preferences?: NotesPreferences;
};

/**
 * Who a preference is for: `everywhere` for choices a person makes once (the paper's
 * pattern and size, recent commands), `this-computer` for how this window was left (open
 * folders, the last note, pane sizes).
 */
export type NotesPreferenceScope = "everywhere" | "this-computer";

/**
 * A host's own store for the screens' preferences, so they live with the host's settings
 * (and its sync) instead of the window's localStorage. Reads are synchronous; values are
 * JSON-safe and `undefined` means none.
 */
export type NotesPreferences = {
  read(key: string, scope: NotesPreferenceScope): unknown;
  /** Saves `value`; `undefined` forgets the key. */
  write(key: string, value: unknown, scope: NotesPreferenceScope): void;
  /** Calls `listener` when values change from elsewhere (another window or computer). */
  subscribe?(listener: () => void): () => void;
};

export type NotesCapabilities = {
  /** Saved versions of each note (`notes.history`, `notes.version`, `notes.restoreVersion`). */
  history: boolean;
  /** PDF, Word and Markdown file tabs, and opening files from this computer (`files.*`). */
  files: boolean;
};

// Kept on the global object, so every copy of this module (after a test resets modules, or
// when a bundle holds two) reads the same host.
const HOST_KEY = Symbol.for("loam.notesHost");
const hostSlot = globalThis as { [HOST_KEY]?: NotesHost };

/** Sets where the notes screens read and save; call once, before they render. */
export const configureNotesHost = (next: NotesHost) => {
  hostSlot[HOST_KEY] = next;
};

/** The host, or null before one is set. */
export const configuredNotesHost = (): NotesHost | null => hostSlot[HOST_KEY] ?? null;

export const notesCapabilities = (): NotesCapabilities => ({
  history: true,
  files: true,
  ...configuredNotesHost()?.capabilities,
});

export const notesHost = (): NotesHost => {
  const host = configuredNotesHost();
  if (!host) throw new Error("The notes host isn't set: call configureNotesHost first.");
  return host;
};

/** A failed bridge request. `code` is the store's reason, such as `NOT_FOUND`. */
export class BridgeError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}

/** Sends one request to the host and returns its data; throws `BridgeError` on failure. */
export const callBridge = async <M extends NotesHostMethod>(
  method: M,
  params: LoamBridgeParams<M>,
): Promise<LoamBridgeResult<M>> => {
  const result = await notesHost().invoke(method, params);
  if (!result.ok) throw new BridgeError(result.error.message, result.error.code);
  return result.data;
};

/** Calls `listener` with each `event` the host sends; returns an unsubscribe. */
export const onBridgeEvent = <E extends NotesHostEvent>(
  event: E,
  listener: (payload: LoamBridgeEvents[E]) => void,
): (() => void) => notesHost().on(event, listener);

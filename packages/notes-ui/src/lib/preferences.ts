/*
 * Small UI preferences, such as panel sizes, kept by the host when it offers a store
 * (`NotesHost.preferences`) and as JSON in the window's localStorage otherwise. They are
 * best effort: a value that can't be read or written leaves the default in place.
 */

import { configuredNotesHost, type NotesPreferenceScope } from "../host/notesHost";

export type { NotesPreferenceScope };

const PREFIX = "loam:";

const hostPreferences = () => configuredNotesHost()?.preferences ?? null;

/** The stored value for `key`, if `read` accepts it; null when missing or unreadable. */
export const readPreference = <T>(
  key: string,
  read: (value: unknown) => T | null,
  scope: NotesPreferenceScope = "this-computer",
): T | null => {
  try {
    const host = hostPreferences();
    if (host) {
      const value = host.read(key, scope);
      return value === undefined ? null : read(value);
    }
    const stored = localStorage.getItem(PREFIX + key);
    return stored === null ? null : read(JSON.parse(stored));
  } catch {
    return null;
  }
};

export const writePreference = (
  key: string,
  value: unknown,
  scope: NotesPreferenceScope = "this-computer",
) => {
  try {
    const host = hostPreferences();
    if (host) host.write(key, value, scope);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // A full or unavailable storage keeps the previous value.
  }
};

export const removePreference = (key: string, scope: NotesPreferenceScope = "this-computer") => {
  try {
    const host = hostPreferences();
    if (host) host.write(key, undefined, scope);
    else localStorage.removeItem(PREFIX + key);
  } catch {
    // Nothing to remove from storage that can't be reached.
  }
};

/** Calls `listener` when the host's preferences change from elsewhere; localStorage never does. */
export const subscribeToPreferences = (listener: () => void) =>
  hostPreferences()?.subscribe?.(listener) ?? (() => undefined);

/** Reads a finite number, for sizes and positions. */
export const asNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/*
 * Small UI preferences, such as panel sizes, kept as JSON in the window's
 * localStorage. They are best effort: a value that can't be read or written
 * leaves the default in place.
 */

const PREFIX = "loam:";

/** The stored value for `key`, if `read` accepts it; null when missing or unreadable. */
export const readPreference = <T>(key: string, read: (value: unknown) => T | null): T | null => {
  try {
    const stored = localStorage.getItem(PREFIX + key);
    return stored === null ? null : read(JSON.parse(stored));
  } catch {
    return null;
  }
};

export const writePreference = (key: string, value: unknown) => {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // A full or unavailable storage keeps the previous value.
  }
};

export const removePreference = (key: string) => {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // Nothing to remove from storage that can't be reached.
  }
};

/** Reads a finite number, for sizes and positions. */
export const asNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

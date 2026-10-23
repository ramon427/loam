// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureNotesHost, type NotesHost, type NotesPreferences } from "../../host/notesHost";
import {
  readPreference,
  removePreference,
  subscribeToPreferences,
  writePreference,
} from "../preferences";

const hostWith = (preferences?: NotesPreferences) =>
  configureNotesHost({
    invoke: vi.fn(),
    on: () => () => undefined,
    preferences,
  } as unknown as NotesHost);

const asString = (value: unknown) => (typeof value === "string" ? value : null);

afterEach(() => {
  localStorage.clear();
  hostWith(undefined);
});

describe("preferences", () => {
  it("live in the window's localStorage when the host keeps none", () => {
    hostWith(undefined);
    writePreference("pane", "wide");
    expect(localStorage.getItem("loam:pane")).toBe('"wide"');
    expect(readPreference("pane", asString)).toBe("wide");
    removePreference("pane");
    expect(readPreference("pane", asString)).toBeNull();
  });

  it("go to the host's store with their scope, and come back from it", () => {
    const stored = new Map<string, unknown>();
    const listeners = new Set<() => void>();
    const write = vi.fn((key: string, value: unknown, scope: string) => {
      if (value === undefined) stored.delete(`${scope}:${key}`);
      else stored.set(`${scope}:${key}`, value);
    });
    hostWith({
      read: (key, scope) => stored.get(`${scope}:${key}`),
      write,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });

    writePreference("paper", "dots", "everywhere");
    writePreference("last-note", "n1");
    expect(write).toHaveBeenCalledWith("paper", "dots", "everywhere");
    expect(write).toHaveBeenCalledWith("last-note", "n1", "this-computer");
    expect(readPreference("paper", asString, "everywhere")).toBe("dots");
    expect(readPreference("paper", asString)).toBeNull();
    expect(localStorage.length).toBe(0);

    removePreference("last-note");
    expect(readPreference("last-note", asString)).toBeNull();

    const listener = vi.fn();
    const stop = subscribeToPreferences(listener);
    for (const notify of listeners) notify();
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    expect(listeners.size).toBe(0);
  });
});

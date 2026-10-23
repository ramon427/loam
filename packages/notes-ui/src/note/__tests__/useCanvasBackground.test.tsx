/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureNotesHost, configuredNotesHost, type NotesHost } from "../../host/notesHost";

const host = (canvasBackground?: NotesHost["canvasBackground"]): NotesHost => ({
  invoke: vi.fn(),
  on: () => () => undefined,
  canvasBackground,
});

describe("useCanvasBackground", () => {
  const previous = configuredNotesHost();
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });
  afterEach(() => {
    if (previous) configureNotesHost(previous);
  });

  const useFresh = async () => (await import("../useCanvasBackground")).useCanvasBackground;

  it("starts on graph paper, or on the host's pattern", async () => {
    configureNotesHost(host());
    expect(renderHook(await useFresh()).result.current[0]).toBe("grid");

    vi.resetModules();
    configureNotesHost(host("plain"));
    expect(renderHook(await useFresh()).result.current[0]).toBe("plain");
  });

  it("keeps the pattern someone picked over the host's", async () => {
    configureNotesHost(host("plain"));
    const { result } = renderHook(await useFresh());
    act(() => result.current[1]("dots"));
    expect(result.current[0]).toBe("dots");

    vi.resetModules();
    expect(renderHook(await useFresh()).result.current[0]).toBe("dots");
  });
});

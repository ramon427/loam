// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useNoteMentions } from "../useNoteMentions";

const notes = [{ id: "n2", title: "Reading list" }];

describe("note mentions", () => {
  it("stay closed when the keypress that chose a note reports the text before it", () => {
    const { result } = renderHook(() => useNoteMentions(notes));
    act(() => result.current.track("Compare @rea", 12));
    expect(result.current.open).toBe(true);
    let chosen: { text: string } | null = null;
    act(() => {
      chosen = result.current.choose(notes[0]!, "Compare @rea");
    });
    expect(chosen).toEqual({ text: "Compare @Reading list ", caret: 22 });

    // React's selection event for the same keypress still carries the old text.
    act(() => result.current.track("Compare @rea", 12));
    expect(result.current.open).toBe(false);
    act(() => result.current.track("Compare @Reading list ", 22));
    expect(result.current.open).toBe(false);
    expect(result.current.mentionsIn("Compare @Reading list")).toEqual([
      { noteId: "n2", title: "Reading list" },
    ]);
  });
});

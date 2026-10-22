// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteDocument } from "../../workspace/types";
import { useVideoPane } from "../useVideoPane";

const note = (video?: NoteDocument["video"]): NoteDocument => ({
  id: "note-1",
  title: "Lecture",
  updatedAt: "2026-01-01T00:00:00.000Z",
  tabs: [{ id: "tab", title: "Notes", kind: "page" }],
  blocksByTab: { tab: [] },
  activeTabId: "tab",
  video,
});

const lecture = { url: "https://youtu.be/aaaaaaaaaaa", videoId: "aaaaaaaaaaa" };

const renderPane = (current: NoteDocument, savePosition = vi.fn()) =>
  renderHook(() => useVideoPane({ note: current, savePosition }));

beforeEach(() => localStorage.clear());

describe("the video pane", () => {
  it("opens for a note with a video and stays closed once closed", () => {
    const first = renderPane(note(lecture));
    expect(first.result.current.isOpen).toBe(true);
    act(() => first.result.current.close());
    first.unmount();

    expect(renderPane(note(lecture)).result.current.isOpen).toBe(false);
    expect(renderPane(note()).result.current.isOpen).toBe(false);
  });

  it("starts where the video was left", () => {
    const viewing = renderPane(note({ ...lecture, lastWatchedSeconds: 5 }));
    expect(viewing.result.current.startSeconds).toBe(5);
    act(() => viewing.result.current.trackPosition("aaaaaaaaaaa", 75.6));
    viewing.unmount();

    expect(
      renderPane(note({ ...lecture, lastWatchedSeconds: 5 })).result.current.startSeconds,
    ).toBe(75);
  });

  it("saves the position into the note every fifteen seconds and on leaving", () => {
    const savePosition = vi.fn();
    const editing = renderPane(note(lecture), savePosition);
    act(() => editing.result.current.trackPosition("aaaaaaaaaaa", 10));
    expect(savePosition).not.toHaveBeenCalled();
    act(() => editing.result.current.trackPosition("aaaaaaaaaaa", 16));
    expect(savePosition).toHaveBeenLastCalledWith(16);
    act(() => editing.result.current.trackPosition("aaaaaaaaaaa", 20));
    editing.unmount();
    expect(savePosition).toHaveBeenLastCalledWith(20);
  });

  it("ignores positions reported for another video", () => {
    const savePosition = vi.fn();
    const pane = renderPane(note(lecture), savePosition);
    act(() => pane.result.current.trackPosition("bbbbbbbbbbb", 300));
    pane.unmount();
    expect(savePosition).not.toHaveBeenCalled();
  });

  it("opens at a timestamp and asks the player to seek there each time", () => {
    const pane = renderPane(note(lecture));
    act(() => pane.result.current.close());
    act(() => pane.result.current.seekTo(42));
    expect(pane.result.current.isOpen).toBe(true);
    expect(pane.result.current.startSeconds).toBe(42);
    const first = pane.result.current.seekRequest;
    act(() => pane.result.current.seekTo(42));
    expect(pane.result.current.seekRequest).toMatchObject({ seconds: 42 });
    expect(pane.result.current.seekRequest?.id).not.toBe(first?.id);
  });
});

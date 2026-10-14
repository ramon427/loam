// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { typedTabHistoryGroupWindowMs, useTypedTabHistory } from "../useTypedTabHistory";

describe("useTypedTabHistory", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const freezeClock = (start: number) => {
    let current = start;
    vi.spyOn(Date, "now").mockImplementation(() => current);
    return {
      advance: (deltaMs: number) => {
        current += deltaMs;
      },
    };
  };

  it("supports bounded commit, undo, redo, and divergent edits", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useTypedTabHistory({
        identity: "tab-1",
        value: { value: 0 },
        onCommit,
        limit: 2,
      }),
    );

    act(() => {
      result.current.commit({ value: 1 });
      result.current.commit({ value: 2 });
      result.current.commit({ value: 3 });
    });
    expect(result.current.undo()).toBe(true);
    expect(onCommit).toHaveBeenLastCalledWith({ value: 2 });
    expect(result.current.undo()).toBe(true);
    expect(onCommit).toHaveBeenLastCalledWith({ value: 1 });
    expect(result.current.undo()).toBe(false);
    expect(result.current.redo()).toBe(true);
    expect(onCommit).toHaveBeenLastCalledWith({ value: 2 });

    act(() => {
      result.current.commit({ value: 9 });
    });
    expect(result.current.redo()).toBe(false);
  });

  it("clears stale history when identity or external data changes", () => {
    const onCommit = vi.fn();
    const { result, rerender } = renderHook(
      ({ identity, value }) => useTypedTabHistory({ identity, value, onCommit }),
      { initialProps: { identity: "tab-1", value: { value: 0 } } },
    );

    act(() => {
      result.current.commit({ value: 1 });
    });
    rerender({ identity: "tab-1", value: { value: 42 } });
    expect(result.current.undo()).toBe(false);

    act(() => {
      result.current.commit({ value: 43 });
    });
    rerender({ identity: "tab-2", value: { value: 7 } });
    expect(result.current.undo()).toBe(false);
  });

  it("keeps redo when parent props echo a local commit after undo", () => {
    const onCommit = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }) => useTypedTabHistory({ identity: "graph", value, onCommit }),
      { initialProps: { value: { value: 0 } } },
    );

    act(() => {
      result.current.commit({ value: 1 });
      result.current.undo();
    });
    rerender({ value: { value: 1 } });
    expect(result.current.canRedo()).toBe(true);
    act(() => {
      expect(result.current.redo()).toBe(true);
    });
    expect(onCommit).toHaveBeenLastCalledWith({ value: 1 });

    rerender({ value: { value: 42 } });
    expect(result.current.canUndo()).toBe(false);
  });

  it("keeps Graph redo when the parent normalizes object key order", () => {
    const onCommit = vi.fn();
    const initial = {
      enabled: true,
      nodes: [{ id: "first", title: "First" }],
      edges: [] as string[],
    };
    const { result, rerender } = renderHook(
      ({ value }) => useTypedTabHistory({ identity: "graph", value, onCommit }),
      { initialProps: { value: initial } },
    );

    act(() => {
      result.current.commit({
        ...initial,
        nodes: [...initial.nodes, { id: "second", title: "Second" }],
      });
      result.current.undo();
    });
    rerender({ value: { edges: [], nodes: [{ title: "First", id: "first" }], enabled: true } });

    expect(result.current.canRedo()).toBe(true);
    act(() => {
      expect(result.current.redo()).toBe(true);
    });
    expect(onCommit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([{ id: "second", title: "Second" }]),
      }),
    );
  });

  it("publishes every grouped edit while sharing one past snapshot", () => {
    const clock = freezeClock(1_000);
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useTypedTabHistory({ identity: "graph", value: { title: "Plan" }, onCommit }),
    );

    act(() => {
      result.current.commit({ title: "Plan A" }, "node-1:title");
      clock.advance(40);
      result.current.commit({ title: "Plan AB" }, "node-1:title");
      clock.advance(40);
      result.current.commit({ title: "Plan ABC" }, "node-1:title");
    });

    // Every keystroke reached the owner; only the pre-burst value is undoable.
    expect(onCommit.mock.calls.map((call) => call[0])).toEqual([
      { title: "Plan A" },
      { title: "Plan AB" },
      { title: "Plan ABC" },
    ]);
    expect(result.current.undo()).toBe(true);
    expect(onCommit).toHaveBeenLastCalledWith({ title: "Plan" });
    expect(result.current.canUndo()).toBe(false);
  });

  it("keeps sharing the group while the parent echoes the published burst", () => {
    const clock = freezeClock(2_000);
    const onCommit = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }) => useTypedTabHistory({ identity: "graph", value, onCommit }),
      { initialProps: { value: { label: "" } } },
    );

    act(() => {
      result.current.commit({ label: "l" }, "edge-1:label");
    });
    rerender({ value: { label: "l" } });
    clock.advance(60);
    act(() => {
      result.current.commit({ label: "le" }, "edge-1:label");
    });
    rerender({ value: { label: "le" } });

    expect(result.current.undo()).toBe(true);
    expect(onCommit).toHaveBeenLastCalledWith({ label: "" });
    expect(result.current.canUndo()).toBe(false);
  });

  it("splits the group when the window expires, the group changes, or an edit is ungrouped", () => {
    const clock = freezeClock(3_000);
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useTypedTabHistory({ identity: "graph", value: { title: "A" }, onCommit }),
    );

    act(() => {
      result.current.commit({ title: "AB" }, "node-1:title");
    });
    clock.advance(typedTabHistoryGroupWindowMs + 1);
    act(() => {
      result.current.commit({ title: "ABC" }, "node-1:title");
    });

    expect(result.current.undo()).toBe(true);
    expect(onCommit).toHaveBeenLastCalledWith({ title: "AB" });

    clock.advance(10);
    act(() => {
      result.current.commit({ title: "ABX" }, "node-1:title");
      result.current.commit({ title: "ABXY" }, "node-2:title");
    });
    expect(result.current.undo()).toBe(true);
    expect(onCommit).toHaveBeenLastCalledWith({ title: "ABX" });

    clock.advance(10);
    act(() => {
      result.current.commit({ title: "ABXY1" }, "node-2:title");
      result.current.commit({ title: "ABXY2" });
      result.current.commit({ title: "ABXY3" }, "node-2:title");
    });
    expect(result.current.undo()).toBe(true);
    expect(onCommit).toHaveBeenLastCalledWith({ title: "ABXY2" });
  });

  it("starts a fresh group after undo, redo, or an external replacement", () => {
    const clock = freezeClock(4_000);
    const onCommit = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }) => useTypedTabHistory({ identity: "graph", value, onCommit }),
      { initialProps: { value: { value: 0 } } },
    );

    act(() => {
      result.current.commit({ value: 1 }, "node-1:notes");
      clock.advance(30);
      result.current.commit({ value: 2 }, "node-1:notes");
    });
    expect(result.current.undo()).toBe(true);
    expect(onCommit).toHaveBeenLastCalledWith({ value: 0 });
    clock.advance(30);
    act(() => {
      result.current.commit({ value: 3 }, "node-1:notes");
      clock.advance(30);
      result.current.commit({ value: 4 }, "node-1:notes");
    });
    expect(result.current.undo()).toBe(true);
    expect(onCommit).toHaveBeenLastCalledWith({ value: 0 });
    expect(result.current.canUndo()).toBe(false);

    act(() => {
      result.current.redo();
    });
    expect(onCommit).toHaveBeenLastCalledWith({ value: 4 });
    clock.advance(30);
    act(() => {
      result.current.commit({ value: 5 }, "node-1:notes");
    });
    expect(result.current.undo()).toBe(true);
    expect(onCommit).toHaveBeenLastCalledWith({ value: 4 });

    rerender({ value: { value: 42 } });
    clock.advance(30);
    act(() => {
      result.current.commit({ value: 43 }, "node-1:notes");
    });
    expect(result.current.undo()).toBe(true);
    expect(onCommit).toHaveBeenLastCalledWith({ value: 42 });
    expect(result.current.canUndo()).toBe(false);
  });
});

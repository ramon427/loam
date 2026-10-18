import { describe, expect, it } from "vitest";

import {
  dragRange,
  edgeScrollSpeed,
  layoutDay,
  minutesAtOffset,
  movedRange,
  packSpans,
  resizedEnd,
  snapMinutes,
  visibleSpans,
} from "../calendarLayout";

const at = (hours: number, minutes = 0) => hours * 60 + minutes;

describe("layoutDay", () => {
  it("gives an event alone the whole column", () => {
    expect(layoutDay([{ id: "a", start: at(9), end: at(10) }]).get("a")).toEqual({
      left: 0,
      width: 1,
      level: 0,
      levels: 1,
    });
  });

  it("puts colliding events side by side and leaves events that touch end to start alone", () => {
    const placed = layoutDay([
      { id: "a", start: at(9), end: at(10) },
      { id: "b", start: at(9, 30), end: at(11) },
      { id: "c", start: at(11), end: at(12) },
    ]);
    expect(placed.get("a")).toMatchObject({ left: 0, width: 0.5 });
    expect(placed.get("b")).toMatchObject({ left: 0.5, width: 0.5 });
    expect(placed.get("c")).toMatchObject({ left: 0, width: 1 });
  });

  it("reuses the first free level and widens an event right until the next collision", () => {
    // a: 9-12 spans the morning; b and c sit beside it one after another; d collides only with a.
    const placed = layoutDay([
      { id: "a", start: at(9), end: at(12) },
      { id: "b", start: at(9), end: at(10) },
      { id: "c", start: at(9, 30), end: at(10, 30) },
      { id: "d", start: at(11), end: at(11, 30) },
    ]);
    expect(placed.get("a")).toMatchObject({ level: 0, levels: 3, left: 0, width: 1 / 3 });
    expect(placed.get("b")).toMatchObject({ level: 1, width: 1 / 3 });
    expect(placed.get("c")).toMatchObject({ level: 2, width: 1 / 3 });
    // d is in level 1 (b ended), and nothing in level 2 collides with it, so it widens.
    expect(placed.get("d")).toMatchObject({ level: 1, left: 1 / 3, width: 2 / 3 });
  });

  it("keeps groups that don't collide apart, each with its own number of levels", () => {
    const placed = layoutDay([
      { id: "a", start: at(8), end: at(9) },
      { id: "b", start: at(8), end: at(9) },
      { id: "c", start: at(8), end: at(9) },
      { id: "d", start: at(14), end: at(15) },
      { id: "e", start: at(14, 30), end: at(15, 30) },
    ]);
    expect(placed.get("c")).toMatchObject({ levels: 3, left: 2 / 3 });
    expect(placed.get("d")).toMatchObject({ levels: 2, width: 0.5 });
  });

  it("joins events through a chain of collisions into one group", () => {
    const placed = layoutDay([
      { id: "a", start: at(9), end: at(10) },
      { id: "b", start: at(9, 45), end: at(11) },
      { id: "c", start: at(10, 30), end: at(12) },
    ]);
    // a and c don't touch, but share a group through b, so c reuses a's level.
    expect(placed.get("a")).toMatchObject({ level: 0, levels: 2 });
    expect(placed.get("c")).toMatchObject({ level: 0, levels: 2 });
    expect(placed.get("b")).toMatchObject({ level: 1 });
  });

  it("treats short events as tall as they are drawn", () => {
    const events = [
      { id: "a", start: at(9), end: at(9, 5) },
      { id: "b", start: at(9, 10), end: at(9, 20) },
    ];
    expect(layoutDay(events).get("a")!.width).toBe(1);
    expect(layoutDay(events, 20).get("a")!.width).toBe(0.5);
  });
});

describe("packSpans and visibleSpans", () => {
  it("stacks bars into the first row free on every day they cover, longest first", () => {
    const rows = packSpans([
      { id: "trip", first: 1, last: 4 },
      { id: "monday", first: 0, last: 0 },
      { id: "tuesday", first: 1, last: 1 },
      { id: "friday", first: 4, last: 4 },
      { id: "weekend", first: 5, last: 6 },
    ]);
    expect(Object.fromEntries(rows)).toEqual({
      monday: 0,
      trip: 0,
      tuesday: 1,
      friday: 1,
      weekend: 0,
    });
  });

  it("shows +N more on the last row of days with more than fits", () => {
    const spans = [
      { id: "a", first: 0, last: 0 },
      { id: "b", first: 0, last: 0 },
      { id: "c", first: 0, last: 0 },
      { id: "d", first: 1, last: 1 },
    ];
    const fitting = visibleSpans(spans, 2, 3);
    expect(fitting.shown).toHaveLength(4);
    expect(fitting.hidden).toEqual([0, 0]);
    const tight = visibleSpans(spans, 2, 2);
    expect(tight.shown.map((span) => span.id)).toEqual(["a", "d"]);
    expect(tight.hidden).toEqual([2, 0]);
    expect(tight.rows).toBe(2);
  });
});

describe("snapping", () => {
  it("turns pixels into minutes and snaps to the nearest quarter hour", () => {
    expect(minutesAtOffset(96, 48)).toBe(120);
    expect(snapMinutes(at(9, 7), 15)).toBe(at(9));
    expect(snapMinutes(at(9, 8), 15)).toBe(at(9, 15));
  });

  it("covers a drag outward to whole steps, at least one step, either way", () => {
    expect(dragRange(at(9, 5), at(9, 5), 15)).toEqual({ start: at(9), end: at(9, 15) });
    expect(dragRange(at(9, 5), at(10, 20), 15)).toEqual({ start: at(9), end: at(10, 30) });
    expect(dragRange(at(10, 5), at(9, 20), 15)).toEqual({ start: at(9, 15), end: at(10, 15) });
    expect(dragRange(at(23, 55), at(25), 15)).toEqual({ start: at(23, 45), end: at(24) });
  });

  it("moves keeping the length and the start inside the day", () => {
    expect(movedRange(at(9), at(10), 37, 15)).toEqual({ start: at(9, 30), end: at(10, 30) });
    expect(movedRange(at(9), at(10), -600, 15)).toEqual({ start: 0, end: at(1) });
    expect(movedRange(at(22), at(23), 600, 15)).toEqual({ start: at(23, 45), end: at(24, 45) });
  });

  it("resizes to the snapped pointer, never shorter than a step", () => {
    expect(resizedEnd(at(9), at(10, 53), 15)).toBe(at(11));
    expect(resizedEnd(at(9), at(8), 15)).toBe(at(9, 15));
    expect(resizedEnd(at(23), at(26), 15)).toBe(at(24));
  });

  it("scrolls faster the closer a drag is to an edge", () => {
    expect(edgeScrollSpeed(300, 100, 700)).toBe(0);
    expect(edgeScrollSpeed(100, 100, 700)).toBe(-18);
    expect(edgeScrollSpeed(124, 100, 700)).toBe(-9);
    expect(edgeScrollSpeed(690, 100, 700)).toBeGreaterThan(0);
  });
});

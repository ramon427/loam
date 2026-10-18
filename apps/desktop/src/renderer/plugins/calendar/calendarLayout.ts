/*
 * The geometry of the calendar grid: where overlapping events sit side by side in a day, how
 * all-day and month bars stack into rows, and how a pointer's position snaps to times.
 *
 * The overlap layout follows FullCalendar's time grid (MIT License, Copyright (c) 2021 Adam
 * Shaw): each event goes into the first level (column) where it collides with nothing,
 * colliding events form groups (here with a union-find), and an event widens to the right
 * until the next level that holds an event it collides with.
 */

export const DAY_MINUTES = 24 * 60;

/** An event's place in one day, in minutes from that day's midnight. */
export type DaySegment = { id: string; start: number; end: number };

/** Its horizontal place in the day's column, each as a fraction of the column's width. */
export type SegmentPlacement = { left: number; width: number; level: number; levels: number };

const byStartThenLength = (a: DaySegment, b: DaySegment) =>
  a.start - b.start || b.end - b.start - (a.end - a.start) || a.id.localeCompare(b.id);

/**
 * Side-by-side places for a day's timed events. `minMinutes` is the shortest an event is
 * drawn, so a five-minute event still collides with what its box covers.
 */
export const layoutDay = (segments: readonly DaySegment[], minMinutes = 0) => {
  const sorted = segments
    .map((segment) => ({ ...segment, end: Math.max(segment.end, segment.start + minMinutes) }))
    .sort(byStartThenLength);
  const collide = (a: DaySegment, b: DaySegment) => a.start < b.end && b.start < a.end;

  // Union-find: events that collide, directly or through others, form one group.
  const parent = sorted.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]!]!;
      index = parent[index]!;
    }
    return index;
  };
  for (let a = 0; a < sorted.length; a += 1)
    for (let b = a + 1; b < sorted.length && sorted[b]!.start < sorted[a]!.end; b += 1)
      if (collide(sorted[a]!, sorted[b]!)) parent[find(b)] = find(a);

  const groups = new Map<number, DaySegment[]>();
  sorted.forEach((segment, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), segment]);
  });

  const placements = new Map<string, SegmentPlacement>();
  for (const group of groups.values()) {
    const levels: DaySegment[][] = [];
    const levelOf = new Map<DaySegment, number>();
    for (const segment of group) {
      let level = levels.findIndex((placed) => !placed.some((other) => collide(segment, other)));
      if (level === -1) level = levels.push([]) - 1;
      levels[level]!.push(segment);
      levelOf.set(segment, level);
    }
    for (const segment of group) {
      const level = levelOf.get(segment)!;
      let span = 1;
      while (
        level + span < levels.length &&
        !levels[level + span]!.some((other) => collide(segment, other))
      )
        span += 1;
      placements.set(segment.id, {
        left: level / levels.length,
        width: span / levels.length,
        level,
        levels: levels.length,
      });
    }
  }
  return placements;
};

/** A bar across whole days: the first and last day it covers, counted in the visible range. */
export type DaySpan = { id: string; first: number; last: number };

/** The row each bar sits in: the first row free on every day it covers, longest bars first. */
export const packSpans = (spans: readonly DaySpan[]) => {
  const sorted = [...spans].sort(
    (a, b) =>
      a.first - b.first || b.last - b.first - (a.last - a.first) || a.id.localeCompare(b.id),
  );
  const rows: DaySpan[][] = [];
  const rowOf = new Map<string, number>();
  for (const span of sorted) {
    let row = rows.findIndex((placed) =>
      placed.every((other) => other.last < span.first || other.first > span.last),
    );
    if (row === -1) row = rows.push([]) - 1;
    rows[row]!.push(span);
    rowOf.set(span.id, row);
  }
  return rowOf;
};

/**
 * Which bars fit in `maxRows` rows over `days` days, and how many each day hides. When any day
 * has more than fits, the last row shows "+N more" instead, as Google Calendar does.
 */
export const visibleSpans = (spans: readonly DaySpan[], days: number, maxRows: number) => {
  const rows = packSpans(spans);
  const counts = Array.from({ length: days }, () => 0);
  for (const span of spans)
    for (let day = Math.max(0, span.first); day <= Math.min(days - 1, span.last); day += 1)
      counts[day]! += 1;
  const overflows = counts.some((count) => count > maxRows);
  const limit = overflows ? Math.max(0, maxRows - 1) : maxRows;
  const hidden = Array.from({ length: days }, () => 0);
  const shown: (DaySpan & { row: number })[] = [];
  for (const span of spans) {
    const row = rows.get(span.id)!;
    if (row < limit) shown.push({ ...span, row });
    else
      for (let day = Math.max(0, span.first); day <= Math.min(days - 1, span.last); day += 1)
        hidden[day]! += 1;
  }
  return { shown, hidden, rows: Math.min(limit + (overflows ? 1 : 0), Math.max(0, ...counts)) };
};

const floorTo = (value: number, step: number) => Math.floor(value / step) * step;
const ceilTo = (value: number, step: number) => Math.ceil(value / step) * step;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Minutes from the top of the day for a pointer `offset` pixels down it. */
export const minutesAtOffset = (offset: number, hourHeight: number) => (offset / hourHeight) * 60;

/** The nearest step, such as a quarter of an hour. */
export const snapMinutes = (minutes: number, step: number) => Math.round(minutes / step) * step;

/**
 * The range a drag from `anchor` to `current` covers, snapped outward to whole steps and at
 * least one step long, within the day.
 */
export const dragRange = (anchor: number, current: number, step: number) => {
  const from = clamp(floorTo(anchor, step), 0, DAY_MINUTES - step);
  if (current >= anchor)
    return { start: from, end: clamp(ceilTo(current, step), from + step, DAY_MINUTES) };
  return { start: clamp(floorTo(current, step), 0, from), end: from + step };
};

/** An event moved by `delta` minutes, snapped, keeping its length and its start inside the day. */
export const movedRange = (start: number, end: number, delta: number, step: number) => {
  const length = end - start;
  const next = clamp(snapMinutes(start + delta, step), 0, DAY_MINUTES - Math.min(step, length));
  return { start: next, end: next + length };
};

/** An event's new end as its bottom edge is dragged to `pointer`, at least one step long. */
export const resizedEnd = (start: number, pointer: number, step: number) =>
  clamp(snapMinutes(pointer, step), start + step, DAY_MINUTES);

/**
 * How many pixels a frame to scroll while a drag holds the pointer near the top or bottom
 * edge: faster the closer it is, negative upwards, 0 away from the edges.
 */
export const edgeScrollSpeed = (
  pointer: number,
  top: number,
  bottom: number,
  edge = 48,
  max = 18,
) => {
  if (pointer < top + edge) return -Math.ceil(max * Math.min(1, (top + edge - pointer) / edge));
  if (pointer > bottom - edge)
    return Math.ceil(max * Math.min(1, (pointer - (bottom - edge)) / edge));
  return 0;
};

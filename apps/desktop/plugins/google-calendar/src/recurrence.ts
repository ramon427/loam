import {
  civilDate,
  dayNumber,
  daysInMonth,
  localMidnight,
  onDay,
  toInstant,
  weekdayOf,
} from "./dates";
import type { IcsDate, IcsEvent, RRule } from "./ics";

/*
 * Turns events, recurring or not, into the occurrences that fall in a span of time. A rule is
 * followed in the event's own zone, day by day, so a weekly 9:00 meeting stays at 9:00 across
 * daylight saving changes.
 */

export type Occurrence = {
  event: IcsEvent;
  /** Instants, in milliseconds. */
  start: number;
  end: number;
  allDay: boolean;
};

/** Enough periods for a daily event over a few decades; a rule past it is cut short. */
const MAX_PERIODS = 20_000;
const DAY_MS = 86_400_000;

const dayOf = (date: IcsDate) => dayNumber(date.y, date.m, date.d);

/** The days of one month a MONTHLY or YEARLY rule picks, in order. */
const monthDays = (y: number, m: number, rule: RRule, startDay: number): number[] => {
  const length = daysInMonth(y, m);
  const first = dayNumber(y, m, 1);
  const byMonthDay = rule.byMonthDay
    ?.map((day) => (day > 0 ? day : length + 1 + day))
    .filter((day) => day >= 1 && day <= length)
    .map((day) => first + day - 1);
  const byDay = rule.byDay?.flatMap(({ weekday, ordinal }) => {
    const matching: number[] = [];
    for (let day = first; day < first + length; day += 1)
      if (weekdayOf(day) === weekday) matching.push(day);
    if (ordinal === undefined) return matching;
    const picked = ordinal > 0 ? matching[ordinal - 1] : matching[matching.length + ordinal];
    return picked === undefined ? [] : [picked];
  });
  let days: number[];
  if (byMonthDay && byDay) days = byMonthDay.filter((day) => byDay.includes(day));
  else days = byMonthDay ?? byDay ?? [];
  if (!byMonthDay && !byDay) {
    const { d } = civilDate(startDay);
    days = d <= length ? [first + d - 1] : [];
  }
  return [...new Set(days)].sort((a, b) => a - b);
};

/** The days in a year a YEARLY rule with BYDAY ordinals and no BYMONTH picks, such as 20MO. */
const yearDays = (y: number, rule: RRule) => {
  const first = dayNumber(y, 1, 1);
  const last = dayNumber(y, 12, 31);
  return rule.byDay!.flatMap(({ weekday, ordinal }) => {
    const matching: number[] = [];
    for (let day = first; day <= last; day += 1) if (weekdayOf(day) === weekday) matching.push(day);
    if (ordinal === undefined) return matching;
    const picked = ordinal > 0 ? matching[ordinal - 1] : matching[matching.length + ordinal];
    return picked === undefined ? [] : [picked];
  });
};

const inMonths = (rule: RRule, day: number) =>
  !rule.byMonth || rule.byMonth.includes(civilDate(day).m);

/** The rule's `index`th period: the day it starts on and the days it picks, in order. */
const period = (
  rule: RRule,
  startDay: number,
  index: number,
): { first: number; days: number[] } => {
  const start = civilDate(startDay);
  switch (rule.freq) {
    case "DAILY": {
      const day = startDay + index * rule.interval;
      const { y, m, d } = civilDate(day);
      const length = daysInMonth(y, m);
      const fitsMonthDay =
        !rule.byMonthDay ||
        rule.byMonthDay.some((wanted) => (wanted > 0 ? wanted : length + 1 + wanted) === d);
      const fitsWeekday =
        !rule.byDay || rule.byDay.some(({ weekday }) => weekday === weekdayOf(day));
      return { first: day, days: inMonths(rule, day) && fitsMonthDay && fitsWeekday ? [day] : [] };
    }
    case "WEEKLY": {
      const weekStart = startDay - ((weekdayOf(startDay) - rule.weekStart + 7) % 7);
      const first = weekStart + index * 7 * rule.interval;
      const weekdays = rule.byDay?.map(({ weekday }) => weekday) ?? [weekdayOf(startDay)];
      const days: number[] = [];
      for (let day = first; day < first + 7; day += 1)
        if (weekdays.includes(weekdayOf(day) as never) && inMonths(rule, day)) days.push(day);
      return { first, days };
    }
    case "MONTHLY": {
      const months = start.m - 1 + index * rule.interval;
      const y = start.y + Math.floor(months / 12);
      const m = (months % 12) + 1;
      const first = dayNumber(y, m, 1);
      if (rule.byMonth && !rule.byMonth.includes(m)) return { first, days: [] };
      return { first, days: monthDays(y, m, rule, startDay) };
    }
    case "YEARLY": {
      const y = start.y + index * rule.interval;
      const first = dayNumber(y, 1, 1);
      if (rule.byDay?.some(({ ordinal }) => ordinal !== undefined) && !rule.byMonth)
        return { first, days: [...new Set(yearDays(y, rule))].sort((a, b) => a - b) };
      return {
        first,
        days: (rule.byMonth ?? [start.m]).flatMap((m) =>
          m >= 1 && m <= 12 ? monthDays(y, m, rule, startDay) : [],
        ),
      };
    }
  }
};

/** The first period worth looking at for a span starting on `fromDay`, when no COUNT needs the ones before. */
const firstUsefulPeriod = (rule: RRule, startDay: number, fromDay: number) => {
  if (rule.count !== undefined || fromDay <= startDay) return 0;
  const span = fromDay - startDay;
  // The longest a period can be, so the guess never lands past the span's start.
  const longest = { DAILY: 1, WEEKLY: 7, MONTHLY: 31, YEARLY: 366 }[rule.freq];
  return Math.max(0, Math.floor(span / (longest * rule.interval)) - 2);
};

/** The days BYSETPOS picks out of one period's, such as -1 for the last. */
const atSetPositions = (days: number[], positions: number[] | undefined) =>
  positions
    ? positions
        .map((position) => (position > 0 ? days[position - 1] : days[days.length + position]))
        .filter((day): day is number => day !== undefined)
        .sort((a, b) => a - b)
    : days;

/**
 * The starts a rule gives, from DTSTART (always the first) up to `to`, ending earlier at its
 * COUNT or UNTIL. Starts before `from` are left out, though COUNT still counts them.
 */
const expandRule = (start: IcsDate, rule: RRule, from: number, to: number): IcsDate[] => {
  const startDay = dayOf(start);
  const untilDay = rule.until?.kind === "date" ? dayOf(rule.until) : null;
  const untilInstant = rule.until?.kind === "time" ? toInstant(rule.until) : null;
  const pastUntil = (date: IcsDate) =>
    (untilDay !== null && dayOf(date) > untilDay) ||
    (untilInstant !== null && toInstant(date) > untilInstant);
  const out: IcsDate[] = [];
  let count = 0;
  const take = (date: IcsDate, instant: number) => {
    count += 1;
    if (instant >= from) out.push(date);
  };

  const startInstant = toInstant(start);
  if (startInstant > to) return out;
  take(start, startInstant);

  const fromDay = Math.floor((from - DAY_MS) / DAY_MS);
  for (let index = firstUsefulPeriod(rule, startDay, fromDay); index < MAX_PERIODS; index += 1) {
    const { first, days: candidates } = period(rule, startDay, index);
    if (localMidnight(first) > to) return out;
    const days = atSetPositions(candidates, rule.bySetPos);
    for (const day of days) {
      if (day <= startDay) continue;
      const date = onDay(start, day);
      if (pastUntil(date)) return out;
      const instant = toInstant(date);
      if (instant > to) return out;
      take(date, instant);
      if (rule.count !== undefined && count >= rule.count) return out;
    }
  }
  return out;
};

const sameMoment = (a: IcsDate, b: IcsDate) =>
  a.kind === "date" || b.kind === "date" ? dayOf(a) === dayOf(b) : toInstant(a) === toInstant(b);

/** How long an event lasts: in days for an all-day event, else in milliseconds. */
const lengthOf = (event: IcsEvent): { days: number } | { ms: number } => {
  if (event.start.kind === "date") {
    if (event.end) return { days: Math.max(1, dayOf(event.end) - dayOf(event.start)) };
    if (event.duration) return { days: Math.max(1, Math.round(event.duration / 86_400)) };
    return { days: 1 };
  }
  if (event.end) return { ms: Math.max(0, toInstant(event.end) - toInstant(event.start)) };
  return { ms: Math.max(0, (event.duration ?? 0) * 1000) };
};

const occurrence = (event: IcsEvent, start: IcsDate): Occurrence => {
  const length = lengthOf(event);
  const startInstant = toInstant(start);
  return {
    event,
    start: startInstant,
    end: "days" in length ? localMidnight(dayOf(start) + length.days) : startInstant + length.ms,
    allDay: start.kind === "date",
  };
};

const overlaps = (item: Occurrence, from: number, to: number) =>
  item.start < to && (item.end > from || (item.end === item.start && item.start >= from));

/**
 * Every occurrence of `events` that overlaps [from, to), in order, all-day ones first on each
 * day. An event with a RECURRENCE-ID takes the place of the occurrence it names. Cancelled
 * events and occurrences are left out, unless `cancelled` is "show" (Outlook keeps a
 * cancelled meeting in the calendar until it is removed).
 */
export const occurrencesBetween = (
  events: IcsEvent[],
  from: number,
  to: number,
  { cancelled = "hide" }: { cancelled?: "show" | "hide" } = {},
) => {
  const replaced = new Map<string, IcsDate[]>();
  for (const event of events)
    if (event.recurrenceId)
      replaced.set(event.uid, [...(replaced.get(event.uid) ?? []), event.recurrenceId]);

  const found: Occurrence[] = [];
  for (const event of events) {
    if (event.cancelled && cancelled === "hide") continue;
    if (event.recurrenceId) {
      const item = occurrence(event, event.start);
      if (overlaps(item, from, to)) found.push(item);
      continue;
    }
    if (!event.rrule && event.rdates.length === 0) {
      const item = occurrence(event, event.start);
      if (overlaps(item, from, to)) found.push(item);
      continue;
    }
    const length = lengthOf(event);
    // Reach back far enough to catch an occurrence that began before `from` and is still on.
    const lookBack = "days" in length ? length.days * DAY_MS + DAY_MS : length.ms;
    const starts = [
      ...(event.rrule ? expandRule(event.start, event.rrule, from - lookBack, to) : [event.start]),
      ...event.rdates,
    ];
    const skipped = [...event.exdates, ...(replaced.get(event.uid) ?? [])];
    const seen = new Set<number>();
    for (const start of starts) {
      if (skipped.some((date) => sameMoment(date, start))) continue;
      const item = occurrence(event, start);
      if (seen.has(item.start) || !overlaps(item, from, to)) continue;
      seen.add(item.start);
      found.push(item);
    }
  }
  return found.sort(
    (a, b) =>
      a.start - b.start ||
      Number(b.allDay) - Number(a.allDay) ||
      a.event.summary.localeCompare(b.event.summary),
  );
};

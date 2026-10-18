import type { IcsDate } from "./ics";

/*
 * Calendar arithmetic on days counted from 1970-01-01, which has no time zones or daylight
 * saving in it, and the step from a day and time in an event's zone to an instant.
 */

const DAY_MS = 86_400_000;

/** Days since 1970-01-01 of a civil date. */
export const dayNumber = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / DAY_MS;

/** The civil date of a day number. */
export const civilDate = (day: number) => {
  const date = new Date(day * DAY_MS);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
};

/** The weekday of a day number, Sunday = 0. */
export const weekdayOf = (day: number) => (((day + 4) % 7) + 7) % 7;

export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const formatters = new Map<string, Intl.DateTimeFormat | null>();
const formatterFor = (zone: string) => {
  if (!formatters.has(zone)) {
    try {
      formatters.set(
        zone,
        new Intl.DateTimeFormat("en-US", {
          timeZone: zone,
          hourCycle: "h23",
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
        }),
      );
    } catch {
      // Not a zone the runtime knows (such as a Windows zone name): read the time as local.
      formatters.set(zone, null);
    }
  }
  return formatters.get(zone)!;
};

/** How far `zone` is ahead of UTC at `instant`, in milliseconds. */
const zoneOffset = (format: Intl.DateTimeFormat, instant: number) => {
  const parts = Object.fromEntries(
    format.formatToParts(new Date(instant)).map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  const wall = Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour! % 24,
    parts.minute!,
    parts.second!,
  );
  return wall - Math.floor(instant / 1000) * 1000;
};

/**
 * The instant a date or date-time names. A DATE is the viewer's local midnight, so all-day
 * events stay on their day wherever the viewer is.
 */
export const toInstant = (date: IcsDate): number => {
  if (date.kind === "date") return new Date(date.y, date.m - 1, date.d).getTime();
  const { y, m, d, h, mi, s, zone } = date;
  if (zone === "utc") return Date.UTC(y, m - 1, d, h, mi, s);
  const format = zone === "floating" ? null : formatterFor(zone);
  if (!format) return new Date(y, m - 1, d, h, mi, s).getTime();
  const wall = Date.UTC(y, m - 1, d, h, mi, s);
  // Two passes settle times near a daylight saving change.
  const first = wall - zoneOffset(format, wall);
  const second = wall - zoneOffset(format, first);
  return second;
};

/** The same date or date-time moved to another day, keeping its time and zone. */
export const onDay = (date: IcsDate, day: number): IcsDate => ({ ...date, ...civilDate(day) });

/** The local-midnight instant of a day number. */
export const localMidnight = (day: number) => {
  const { y, m, d } = civilDate(day);
  return new Date(y, m - 1, d).getTime();
};

/** The day number of the local day an instant falls on. */
export const localDay = (instant: number) => {
  const date = new Date(instant);
  return dayNumber(date.getFullYear(), date.getMonth() + 1, date.getDate());
};

import { toInstant } from "./dates";

/*
 * Wall-clock times in a named time zone: what an event's editor shows, and the instant it
 * saves. The zone is the event's own (Google keeps one per start and end), else the computer's.
 */

export type WallTime = { y: number; m: number; d: number; h: number; mi: number; s: number };

export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const formats = new Map<string, Intl.DateTimeFormat>();
const formatFor = (zone: string): Intl.DateTimeFormat => {
  let format = formats.get(zone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      });
    } catch {
      format = formatFor(localZone());
    }
    formats.set(zone, format);
  }
  return format;
};

/** The wall-clock time in `zone` at `instant`. */
export const wallTime = (instant: number, zone: string): WallTime => {
  const parts = Object.fromEntries(
    formatFor(zone)
      .formatToParts(new Date(instant))
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  return {
    y: parts.year!,
    m: parts.month!,
    d: parts.day!,
    h: parts.hour! % 24,
    mi: parts.minute!,
    s: parts.second!,
  };
};

/** The instant a wall-clock time in `zone` names. */
export const zonedInstant = (wall: WallTime, zone: string) =>
  toInstant({ kind: "time", ...wall, zone });

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

export const wallDate = (wall: Pick<WallTime, "y" | "m" | "d">) =>
  `${pad(wall.y, 4)}-${pad(wall.m)}-${pad(wall.d)}`;

export const wallClock = (wall: Pick<WallTime, "h" | "mi">) => `${pad(wall.h)}:${pad(wall.mi)}`;

/** `YYYY-MM-DD` and `HH:MM` from the editor's fields, as a wall-clock time. */
export const parseWall = (date: string, clock: string): WallTime | null => {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const time = /^(\d{2}):(\d{2})/.exec(clock);
  if (!day || !time) return null;
  return {
    y: Number(day[1]),
    m: Number(day[2]),
    d: Number(day[3]),
    h: Number(time[1]),
    mi: Number(time[2]),
    s: 0,
  };
};

/** An instant as RFC 3339 in UTC, which Google takes with any zone beside it. */
export const rfc3339 = (instant: number) =>
  new Date(instant).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Zones the editor offers besides the event's and the computer's own. */
const COMMON_ZONES = [
  "UTC",
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Halifax",
  "America/Sao_Paulo",
  "Atlantic/Reykjavik",
  "Europe/London",
  "Europe/Lisbon",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Stockholm",
  "Europe/Athens",
  "Europe/Helsinki",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
];

/** The zones to pick from: these first, then the common ones, each once. */
export const zoneChoices = (...first: (string | null | undefined)[]) => [
  ...new Set([...first.filter((zone): zone is string => Boolean(zone)), ...COMMON_ZONES]),
];

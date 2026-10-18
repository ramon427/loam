/*
 * The calendar grid's dates, in the computer's own time zone. A plugin gives events as ISO
 * strings: a date (`2026-10-19`, exclusive at the end, as Google Calendar's all-day events
 * are) or a date-time with an offset. The grid answers in the same forms.
 */

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Local midnight of a `YYYY-MM-DD` date. */
export const dayStart = (day: string) => {
  const match = DAY_PATTERN.exec(day);
  if (!match) return Number.NaN;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
};

/** The `YYYY-MM-DD` of the local day an instant falls on. */
export const dayKey = (instant: number) => {
  const date = new Date(instant);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/** Local midnight `days` calendar days after the day `instant` falls on, across DST changes. */
export const addDays = (instant: number, days: number) => {
  const date = new Date(instant);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
};

/** The same wall-clock time `days` calendar days later. */
export const shiftDays = (instant: number, days: number) => {
  const date = new Date(instant);
  date.setDate(date.getDate() + days);
  return date.getTime();
};

/** An instant as a local date-time with its offset, as `2026-10-19T09:30:00+02:00`. */
export const isoLocal = (instant: number) => {
  const date = new Date(instant);
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const pad = (value: number) => String(Math.abs(value)).padStart(2, "0");
  return `${dayKey(instant)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
};

/** An event's start or end: a date is its local midnight, a date-time its instant. */
export const parseEventTime = (value: string) =>
  DAY_PATTERN.test(value) ? dayStart(value) : Date.parse(value);

/** Minutes from the local midnight of `day` to `instant`. */
export const minutesInto = (day: number, instant: number) => (instant - day) / 60_000;

const timeFormat = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" });
const hour12 = timeFormat.resolvedOptions().hour12 === true;
const hourFormat = new Intl.DateTimeFormat(
  [],
  hour12 ? { hour: "numeric" } : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
);

/** "9:30 AM" or "09:30", as the computer's locale writes times. */
export const formatTime = (instant: number) => timeFormat.format(instant);

/** An hour's label down the side of the grid: "9 AM" or "09:00". */
export const formatHour = (hour: number) => hourFormat.format(new Date(2000, 0, 1, hour));

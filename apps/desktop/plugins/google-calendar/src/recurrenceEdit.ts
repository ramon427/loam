import { civilDate, dayNumber, toInstant } from "./dates";
import { instantOf, type GDate, type GEvent } from "./googleEvents";
import { parseIcsDate, parseRRule, type IcsDate, type IcsEvent } from "./ics";
import { occurrencesBetween } from "./recurrence";
import { localZone, wallTime, zonedInstant } from "./zones";

/*
 * Changing part of a recurring series, as Google Calendar's "This event", "This and
 * following events" and "All events" do. "This and following" ends the series just before
 * the chosen instance (UNTIL, in UTC for timed events and as a date for all-day ones, with
 * COUNT dropped) and starts a new series there with the changes, its COUNT reduced by the
 * instances that came before. The approach follows Proton Calendar's; the code is Loam's.
 */

export type RecurringScope = "this" | "following" | "all";

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

/** An instant as an iCalendar UTC date-time, `YYYYMMDDTHHMMSSZ`. */
const icsUtc = (instant: number) => {
  const date = new Date(instant);
  return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
};

/**
 * The UNTIL that ends a series just before the instance starting at `pivot`: a second before
 * it in UTC for a timed series, the day before it for an all-day one.
 */
export const untilBefore = (pivot: GDate) => {
  if (pivot.date) {
    const [y, m, d] = pivot.date.split("-").map(Number);
    const before = civilDate(dayNumber(y!, m!, d!) - 1);
    return `${pad(before.y, 4)}${pad(before.m)}${pad(before.d)}`;
  }
  return icsUtc(Date.parse(pivot.dateTime!) - 1000);
};

type RuleLine = { name: string; params: Record<string, string>; value: string };

const parseLine = (line: string): RuleLine => {
  const colon = line.indexOf(":");
  const [name = "", ...params] = line.slice(0, colon).split(";");
  return {
    name: name.toUpperCase(),
    params: Object.fromEntries(
      params.map((param) => {
        const [key = "", value = ""] = param.split("=");
        return [key.toUpperCase(), value];
      }),
    ),
    value: line.slice(colon + 1),
  };
};

const writeLine = ({ name, params, value }: RuleLine) =>
  `${[name, ...Object.entries(params).map(([key, item]) => `${key}=${item}`)].join(";")}:${value}`;

const ruleParts = (value: string) =>
  value
    .split(";")
    .filter(Boolean)
    .map((part) => {
      const [key = "", item = ""] = part.split("=");
      return [key.toUpperCase(), item] as [string, string];
    });

const writeRule = (parts: [string, string][]) =>
  parts.map(([key, item]) => `${key}=${item}`).join(";");

/** The instants an EXDATE or RDATE line lists. */
const datesOf = (line: RuleLine, zone: string) =>
  line.value.split(",").map((value) => {
    const date = parseIcsDate(value, line.params);
    if (!date) return Number.NaN;
    return date.kind === "time" && date.zone === "floating"
      ? toInstant({ ...date, zone })
      : toInstant(date);
  });

/** EXDATE and RDATE lines with only the dates `keep` accepts; a line left empty goes. */
const filterDates = (line: RuleLine, zone: string, keep: (instant: number) => boolean) => {
  const values = line.value.split(",");
  const instants = datesOf(line, zone);
  const kept = values.filter((_, index) => keep(instants[index]!));
  return kept.length ? [writeLine({ ...line, value: kept.join(",") })] : [];
};

const zoneOf = (event: Pick<GEvent, "start">) => event.start?.timeZone ?? localZone();

/** The master's recurrence, ended just before the instance starting at `pivot`. */
export const endedBefore = (master: Pick<GEvent, "recurrence" | "start">, pivot: GDate) => {
  const zone = zoneOf(master);
  const at = instantOf(pivot);
  return (master.recurrence ?? []).flatMap((raw) => {
    const line = parseLine(raw);
    if (line.name === "RRULE")
      return [
        writeLine({
          ...line,
          value: writeRule([
            ...ruleParts(line.value).filter(([key]) => key !== "COUNT" && key !== "UNTIL"),
            ["UNTIL", untilBefore(pivot)],
          ]),
        }),
      ];
    if (line.name === "EXDATE" || line.name === "RDATE")
      return filterDates(line, zone, (instant) => instant < at);
    return [raw];
  });
};

/**
 * The recurrence of the series that carries on from `pivot`: COUNT lowered by the `before`
 * instances the old series keeps, and only the exceptions from the pivot on.
 */
export const carriedFrom = (
  master: Pick<GEvent, "recurrence" | "start">,
  pivot: GDate,
  before: number,
) => {
  const zone = zoneOf(master);
  const at = instantOf(pivot);
  return (master.recurrence ?? []).flatMap((raw) => {
    const line = parseLine(raw);
    if (line.name === "RRULE")
      return [
        writeLine({
          ...line,
          value: writeRule(
            ruleParts(line.value).map(([key, item]) =>
              key === "COUNT" ? [key, String(Math.max(1, Number(item) - before))] : [key, item],
            ),
          ),
        }),
      ];
    if (line.name === "EXDATE" || line.name === "RDATE")
      return filterDates(line, zone, (instant) => instant >= at);
    return [raw];
  });
};

/** A Google start as the date or date-time in its zone the recurrence reader takes. */
const icsStart = (start: GDate): IcsDate => {
  if (start.date) {
    const [y, m, d] = start.date.split("-").map(Number);
    return { kind: "date", y: y!, m: m!, d: d! };
  }
  const zone = start.timeZone ?? localZone();
  return { kind: "time", ...wallTime(Date.parse(start.dateTime!), zone), zone };
};

/**
 * How many instances the series has before `pivot`, counting the ones EXDATE removed, as
 * COUNT does (RFC 5545, 3.3.10).
 */
export const instancesBefore = (master: Pick<GEvent, "recurrence" | "start">, pivot: GDate) => {
  const rule = (master.recurrence ?? []).map(parseLine).find((line) => line.name === "RRULE");
  const rrule = rule ? parseRRule(rule.value) : null;
  if (!rrule || !master.start) return 0;
  const event: IcsEvent = {
    uid: "series",
    summary: "",
    description: "",
    location: "",
    url: "",
    start: icsStart(master.start),
    end: null,
    duration: 0,
    rrule,
    exdates: [],
    rdates: [],
    recurrenceId: null,
    status: "",
  };
  return occurrencesBetween([event], instantOf(master.start), instantOf(pivot)).filter(
    (item) => item.start < instantOf(pivot),
  ).length;
};

/** Whether the instance is the series' first, where "this and following" is "all". */
export const isFirstInstance = (
  master: Pick<GEvent, "start">,
  instance: Pick<GEvent, "originalStartTime" | "start">,
) => instantOf(instance.originalStartTime ?? instance.start) <= instantOf(master.start);

/** How far a start moved, in whole days and minutes of wall-clock time in `zone`. */
export const wallShift = (from: GDate, to: GDate, zone: string) => {
  if (from.date && to.date) {
    const day = (value: string) => {
      const [y, m, d] = value.split("-").map(Number);
      return dayNumber(y!, m!, d!);
    };
    return { days: day(to.date) - day(from.date), minutes: 0 };
  }
  const before = wallTime(instantOf(from), zone);
  const after = wallTime(instantOf(to), zone);
  return {
    days: dayNumber(after.y, after.m, after.d) - dayNumber(before.y, before.m, before.d),
    minutes: after.h * 60 + after.mi - (before.h * 60 + before.mi),
  };
};

const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** BYDAY weekdays moved by `days`, so a weekly Monday meeting moved to Tuesday stays weekly on Tuesday. */
export const shiftWeekdays = (recurrence: string[], days: number) => {
  const step = ((days % 7) + 7) % 7;
  if (!step) return recurrence;
  return recurrence.map((raw) => {
    const line = parseLine(raw);
    if (line.name !== "RRULE") return raw;
    return writeLine({
      ...line,
      value: writeRule(
        ruleParts(line.value).map(([key, item]) =>
          key === "BYDAY"
            ? [
                key,
                item
                  .split(",")
                  .map((day) => {
                    const match = /^([+-]?\d{1,2})?([A-Z]{2})$/i.exec(day.trim());
                    const index = match ? WEEKDAY_CODES.indexOf(match[2]!.toUpperCase()) : -1;
                    return index < 0
                      ? day
                      : `${match![1] ?? ""}${WEEKDAY_CODES[(index + step) % 7]}`;
                  })
                  .join(","),
              ]
            : [key, item],
        ),
      ),
    });
  });
};

/**
 * The master's new start and end when one instance moved from `from` to `to` and "all events"
 * changes with it: the same move in wall-clock time in the series' zone, and the instance's
 * new length.
 */
export const seriesMovedLike = (
  master: Pick<GEvent, "start" | "end" | "recurrence">,
  from: { start: GDate },
  to: { start: GDate; end: GDate },
): Pick<GEvent, "start" | "end" | "recurrence"> => {
  if (to.start.date && master.start?.date && from.start.date) {
    const day = (value: string) => {
      const [y, m, d] = value.split("-").map(Number);
      return dayNumber(y!, m!, d!);
    };
    const shift = day(to.start.date) - day(from.start.date);
    const length = day(to.end.date!) - day(to.start.date);
    const startDay = day(master.start.date) + shift;
    const iso = (value: number) => {
      const { y, m, d } = civilDate(value);
      return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
    };
    return {
      start: { date: iso(startDay), dateTime: null, timeZone: null },
      end: { date: iso(startDay + length), dateTime: null, timeZone: null },
      recurrence: shiftWeekdays(master.recurrence ?? [], shift),
    };
  }
  const zone = master.start?.timeZone ?? to.start.timeZone ?? localZone();
  const shift = wallShift(from.start, to.start, zone);
  const origin = wallTime(instantOf(master.start), zone);
  const total = origin.h * 60 + origin.mi + shift.minutes;
  const carry = Math.floor(total / 1440);
  const minutes = total - carry * 1440;
  const day = civilDate(dayNumber(origin.y, origin.m, origin.d) + shift.days + carry);
  const start = zonedInstant(
    { ...day, h: Math.floor(minutes / 60), mi: minutes % 60, s: origin.s },
    zone,
  );
  const length = instantOf(to.end) - instantOf(to.start);
  return {
    start: { dateTime: new Date(start).toISOString(), timeZone: zone, date: null },
    end: { dateTime: new Date(start + length).toISOString(), timeZone: zone, date: null },
    recurrence: shiftWeekdays(master.recurrence ?? [], shift.days + carry),
  };
};

/** The fields a new series copies from the one it carries on from. */
export const copiedFields = (master: GEvent): Partial<GEvent> => {
  const {
    id: _id,
    etag: _etag,
    htmlLink: _htmlLink,
    iCalUID: _iCalUID,
    recurringEventId: _recurringEventId,
    originalStartTime: _originalStartTime,
    hangoutLink: _hangoutLink,
    conferenceData,
    organizer: _organizer,
    status: _status,
    ...rest
  } = master;
  // A Meet link carries over as it is; Google keeps one conference for both series.
  return conferenceData?.entryPoints ? { ...rest, conferenceData } : rest;
};

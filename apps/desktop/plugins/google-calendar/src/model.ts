import type { CalendarEvent } from "@loam/plugin-api";

import { civilDate, dayNumber, localDay, localMidnight, weekdayOf } from "./dates";
import {
  eventColor,
  instantOf,
  isAllDay,
  isEditable,
  meetLink,
  selfAttendee,
  type GCalendar,
  type GDate,
  type GEvent,
} from "./googleEvents";
import { joinLinkIn, type JoinLink } from "./meetingLinks";
import { localZone } from "./zones";

/*
 * What the calendar view shows, worked out from Google's events: the grid's events, the days a
 * view covers, Google times from the grid's, and the Markdown for a meeting note or an agenda.
 */

export type ViewName = "day" | "3day" | "week" | "month" | "agenda";

/** Days counted from 1970-01-01 (see dates.ts), the view's first day and how many it shows. */
export type Range = { first: number; days: number };

const AGENDA_DAYS = 14;

/** The weekday a week starts on (Sunday = 0) for the weekStart setting. */
export const weekStartDay = (setting: unknown) =>
  setting === "sunday" ? 0 : setting === "saturday" ? 6 : 1;

const startOfWeek = (day: number, weekStart: number) =>
  day - ((weekdayOf(day) - weekStart + 7) % 7);

/** The days a view shows around `cursor`; a month shows the whole weeks it touches. */
export const viewRange = (view: ViewName, cursor: number, weekStart: number): Range => {
  if (view === "day") return { first: cursor, days: 1 };
  if (view === "3day") return { first: cursor, days: 3 };
  if (view === "week") return { first: startOfWeek(cursor, weekStart), days: 7 };
  if (view === "agenda") return { first: cursor, days: AGENDA_DAYS };
  const { y, m } = civilDate(cursor);
  const monthStart = dayNumber(y, m, 1);
  const nextMonth = m === 12 ? dayNumber(y + 1, 1, 1) : dayNumber(y, m + 1, 1);
  const first = startOfWeek(monthStart, weekStart);
  return { first, days: Math.ceil((nextMonth - first) / 7) * 7 };
};

/** The cursor a step back or forward lands on: a day, three, a week, a month or the agenda's span. */
export const stepCursor = (view: ViewName, cursor: number, direction: number) => {
  if (view === "day") return cursor + direction;
  if (view === "3day") return cursor + 3 * direction;
  if (view === "week") return cursor + 7 * direction;
  if (view === "agenda") return cursor + AGENDA_DAYS * direction;
  const { y, m } = civilDate(cursor);
  const months = m - 1 + direction;
  return dayNumber(y + Math.floor(months / 12), (((months % 12) + 12) % 12) + 1, 1);
};

const format = (day: number, options: Intl.DateTimeFormatOptions) =>
  new Date(localMidnight(day)).toLocaleDateString("en-US", options);

/** The toolbar's title: "October 2026", "Sep – Oct 2026" across months, or the day's date. */
export const rangeTitle = (view: ViewName, range: Range, cursor: number) => {
  if (view === "month") return format(cursor, { month: "long", year: "numeric" });
  if (view === "day") return format(cursor, { month: "long", day: "numeric", year: "numeric" });
  const last = range.first + range.days - 1;
  const a = civilDate(range.first);
  const b = civilDate(last);
  if (a.y === b.y && a.m === b.m) return format(range.first, { month: "long", year: "numeric" });
  if (a.y === b.y)
    return `${format(range.first, { month: "short" })} – ${format(last, { month: "short", year: "numeric" })}`;
  return `${format(range.first, { month: "short", year: "numeric" })} – ${format(last, { month: "short", year: "numeric" })}`;
};

export const isoDay = (day: number) => {
  const { y, m, d } = civilDate(day);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/** An instant as a local date-time with its offset, as the grid takes times. */
export const localIso = (instant: number) => {
  const date = new Date(instant);
  const offset = -date.getTimezoneOffset();
  const pad = (value: number) => String(Math.floor(Math.abs(value))).padStart(2, "0");
  const sign = offset >= 0 ? "+" : "-";
  return `${isoDay(localDay(instant))}T${pad(date.getHours())}:${pad(date.getMinutes())}:00${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
};

export const dayOfIso = (value: string) => {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return dayNumber(y!, m!, d!);
};

/** What a subscribed calendar's event says beyond Google's fields. */
export type EntryExtra = {
  cancelled: boolean;
  private: boolean;
  /** Outlook's free/busy status, such as BUSY or OOF. */
  busyStatus: string;
  joinUrl: string;
};

/** One event as the view keeps it: which calendar it is in, and the key the grid knows it by. */
export type Entry = {
  key: string;
  calendarId: string;
  calendar: GCalendar | undefined;
  event: GEvent;
  extra?: EntryExtra;
};

/** The video call to join: Google's Meet link, else a Teams, Meet or Zoom link in the event. */
export const joinLinkOf = (entry: Pick<Entry, "event" | "extra">): JoinLink | null => {
  const meet = meetLink(entry.event);
  return joinLinkIn(
    entry.extra?.joinUrl,
    meet,
    entry.event.location,
    entry.event.description ? plainText(entry.event.description) : "",
  );
};

export const isDeclined = (event: GEvent) => selfAttendee(event)?.responseStatus === "declined";

/** The entries that overlap the days `from` to `to` (day numbers, `to` exclusive), by start. */
export const entriesIn = (entries: Entry[], from: number, to: number) => {
  const start = localMidnight(from);
  const end = localMidnight(to);
  return entries
    .filter((entry) => {
      const a = instantOf(entry.event.start);
      const b = instantOf(entry.event.end);
      return a < end && (b > a ? b : a + 1) > start;
    })
    .sort(
      (x, y) =>
        Number(isAllDay(y.event)) - Number(isAllDay(x.event)) ||
        instantOf(x.event.start) - instantOf(y.event.start),
    );
};

/** An entry as CalendarGrid draws it. */
export const gridEvent = (entry: Entry): CalendarEvent => {
  const { event, calendar } = entry;
  const allDay = isAllDay(event);
  const start = allDay ? event.start!.date! : event.start!.dateTime!;
  const end = allDay
    ? (event.end?.date ?? isoDay(dayOfIso(start) + 1))
    : (event.end?.dateTime ?? start);
  const self = selfAttendee(event);
  return {
    id: entry.key,
    title: (event.summary || "(No title)").slice(0, 1000),
    start,
    end,
    allDay,
    color: eventColor(event, calendar),
    ...(!isEditable(event, calendar) && { readOnly: true }),
    ...(self?.responseStatus === "declined" && { declined: true }),
    ...(entry.extra?.cancelled && { cancelled: true }),
    ...((self?.responseStatus === "tentative" ||
      self?.responseStatus === "needsAction" ||
      event.status === "tentative") && {
      tentative: true,
    }),
    ...(event.location && { location: event.location.split("\n")[0]!.slice(0, 500) }),
  };
};

/**
 * A time from the grid (a date for all-day, a date-time with offset otherwise) as Google
 * takes it. A timed event keeps its zone; the fields it no longer uses are cleared, as a
 * patch otherwise keeps them.
 */
export const googleTime = (
  value: string,
  allDay: boolean,
  zone: string | null | undefined,
): GDate =>
  allDay
    ? { date: value.slice(0, 10), dateTime: null, timeZone: null }
    : {
        dateTime: new Date(Date.parse(value)).toISOString().replace(/\.000Z$/, "Z"),
        timeZone: zone || localZone(),
        date: null,
      };

const timeOf = (instant: number) =>
  new Date(instant).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** "Monday, October 19 · 9:00 AM – 10:00 AM", or "… · All day". */
export const whenText = (event: GEvent) => {
  const start = instantOf(event.start);
  const end = instantOf(event.end);
  const day = format(localDay(start), { weekday: "long", month: "long", day: "numeric" });
  if (isAllDay(event)) {
    const lastDay = localDay(end) - 1;
    return lastDay > localDay(start)
      ? `${format(localDay(start), { month: "long", day: "numeric" })} – ${format(lastDay, { month: "long", day: "numeric" })} · All day`
      : `${day} · All day`;
  }
  if (localDay(end - 1) !== localDay(start))
    return `${day}, ${timeOf(start)} – ${format(localDay(end), { weekday: "long", month: "long", day: "numeric" })}, ${timeOf(end)}`;
  return `${day} · ${timeOf(start)} – ${timeOf(end)}`;
};

/** "9:00 AM – 10:00 AM" or "All day", for a line in the agenda. */
export const timesText = (event: GEvent, day: number) => {
  if (isAllDay(event)) return "All day";
  const start = instantOf(event.start);
  const end = instantOf(event.end);
  const from = start < localMidnight(day) ? "…" : timeOf(start);
  const to = end > localMidnight(day + 1) ? "…" : timeOf(end);
  return `${from} – ${to}`;
};

const people = (event: GEvent) =>
  (event.attendees ?? [])
    .filter((attendee) => !attendee.resource)
    .map((attendee) => attendee.displayName || attendee.email);

/** Plain text from a description, which Google fills with simple HTML. */
export const plainText = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, (_, href: string, text: string) =>
      text && text !== href ? `${text} (${href})` : href,
    )
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** The meeting note's title: the event and its day. */
export const meetingNoteTitle = (event: GEvent) =>
  `${event.summary || "Meeting"} – ${format(localDay(instantOf(event.start)), { month: "short", day: "numeric", year: "numeric" })}`;

const MEETING_NAMES: Record<JoinLink["kind"], string> = {
  teams: "Microsoft Teams",
  meet: "Google Meet",
  zoom: "Zoom",
};

/**
 * A meeting note's first lines: when, who, the link to join, the description, and a link
 * back. Works for any event, a subscribed calendar's included.
 */
export const meetingNoteMarkdown = (entry: Pick<Entry, "event" | "extra">) => {
  const { event } = entry;
  const lines = [`**When:** ${whenText(event)}`];
  if (event.location) lines.push(`**Where:** ${event.location.split("\n")[0]}`);
  if (event.organizer?.displayName && !event.organizer.self)
    lines.push(`**Organizer:** ${event.organizer.displayName}`);
  const guests = people(event);
  if (guests.length) lines.push(`**Attendees:** ${guests.join(", ")}`);
  const join = joinLinkOf(entry);
  if (join)
    lines.push(
      `**${MEETING_NAMES[join.kind]}:** [${join.kind === "teams" ? "Join the meeting" : join.url.replace(/^https:\/\//, "")}](${join.url})`,
    );
  if (event.htmlLink) lines.push(`[Open in Google Calendar](${event.htmlLink})`);
  const description = event.description ? plainText(event.description) : "";
  return [
    lines.join("\n\n"),
    ...(description ? ["## Description", description] : []),
    "## Notes",
    "- ",
  ].join("\n\n");
};

/** A day's events as a Markdown list, for "Today's agenda" in the slash menu. */
export const agendaMarkdown = (title: string, entries: Entry[], day: number) => {
  const lines = entries.map((entry) => {
    const { event } = entry;
    const where = event.location ? ` (${event.location.split("\n")[0]})` : "";
    const join = joinLinkOf(entry);
    const link = join
      ? ` · [${join.kind === "teams" ? "Teams" : join.kind === "meet" ? "Meet" : "Zoom"}](${join.url})`
      : "";
    const cancelled = entry.extra?.cancelled ? "~~" : "";
    return `- ${timesText(event, day)} ${cancelled}${event.summary || "(No title)"}${cancelled}${where}${link}`;
  });
  return `**${title}**\n\n${lines.length ? lines.join("\n") : "- No events"}\n`;
};

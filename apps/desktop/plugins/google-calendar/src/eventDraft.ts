import { civilDate, weekdayOf } from "./dates";
import { meetLink, type GAttendee, type GEvent } from "./googleEvents";
import { dayOfIso, isoDay } from "./model";
import { localZone, parseWall, wallClock, wallDate, wallTime, zonedInstant } from "./zones";

/*
 * The event editor's fields, as text the inputs show, and the event Google gets from them.
 * An all-day event's end shows as its last day, as Google Calendar shows it; Google keeps the
 * day after.
 */

export type RepeatPreset =
  "none" | "daily" | "weekly" | "weekdays" | "monthly" | "monthlyWeekday" | "yearly" | "custom";

export type Draft = {
  calendarId: string;
  title: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  zone: string;
  location: string;
  description: string;
  /** "" for the calendar's color. */
  colorId: string;
  repeat: RepeatPreset;
  /** The rule for "custom", such as `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH`. */
  rule: string;
  /** EXDATE and RDATE lines the series has, kept as they are. */
  otherRecurrence: string[];
  /** Minutes before, or "default" for the calendar's own. */
  reminders: "default" | number[];
  guests: string[];
  meet: boolean;
  visibility: "default" | "public" | "private";
  busy: boolean;
};

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const ORDINALS = ["first", "second", "third", "fourth", "last"];

/** The rule each preset makes for an event starting on `day` (a day number). */
const presetRule = (preset: RepeatPreset, day: number) => {
  const weekday = WEEKDAYS[weekdayOf(day)]!;
  const { d } = civilDate(day);
  const nth = Math.ceil(d / 7);
  switch (preset) {
    case "daily":
      return "FREQ=DAILY";
    case "weekly":
      return `FREQ=WEEKLY;BYDAY=${weekday}`;
    case "weekdays":
      return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    case "monthly":
      return `FREQ=MONTHLY;BYMONTHDAY=${d}`;
    case "monthlyWeekday":
      return `FREQ=MONTHLY;BYDAY=${nth > 4 ? -1 : nth}${weekday}`;
    case "yearly":
      return "FREQ=YEARLY";
    default:
      return null;
  }
};

/** The repeat choices for an event starting on `day`, labelled as Google Calendar does. */
export const repeatChoices = (day: number) => {
  const { d } = civilDate(day);
  const nth = Math.min(Math.ceil(d / 7), 5);
  const weekday = WEEKDAY_NAMES[weekdayOf(day)]!;
  const date = new Date(Date.UTC(2000, civilDate(day).m - 1, d)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  return [
    { value: "none", label: "Does not repeat" },
    { value: "daily", label: "Daily" },
    { value: "weekly", label: `Weekly on ${weekday}` },
    { value: "weekdays", label: "Every weekday (Monday to Friday)" },
    { value: "monthly", label: `Monthly on day ${d}` },
    { value: "monthlyWeekday", label: `Monthly on the ${ORDINALS[nth - 1]} ${weekday}` },
    { value: "yearly", label: `Annually on ${date}` },
    { value: "custom", label: "Custom…" },
  ];
};

const PRESETS: RepeatPreset[] = [
  "daily",
  "weekly",
  "weekdays",
  "monthly",
  "monthlyWeekday",
  "yearly",
];

const splitRecurrence = (recurrence: string[] | null | undefined, day: number) => {
  const lines = recurrence ?? [];
  const rruleLine = lines.find((line) => line.toUpperCase().startsWith("RRULE:"));
  const otherRecurrence = lines.filter((line) => line !== rruleLine);
  if (!rruleLine) return { repeat: "none" as RepeatPreset, rule: "", otherRecurrence };
  const rule = rruleLine.slice(6);
  const repeat = PRESETS.find((preset) => presetRule(preset, day) === rule) ?? "custom";
  return { repeat, rule, otherRecurrence };
};

/** The editor's fields for an event (an instance shows its series' recurrence, passed in). */
export const draftFromEvent = (
  calendarId: string,
  event: GEvent,
  recurrence: string[] | null | undefined,
): Draft => {
  const allDay = Boolean(event.start?.date);
  const zone = event.start?.timeZone ?? localZone();
  let startDate: string;
  let endDate: string;
  let startTime = "09:00";
  let endTime = "10:00";
  if (allDay) {
    startDate = event.start!.date!;
    const end = event.end?.date ? dayOfIso(event.end.date) - 1 : dayOfIso(startDate);
    endDate = isoDay(Math.max(end, dayOfIso(startDate)));
  } else {
    const start = wallTime(Date.parse(event.start!.dateTime!), zone);
    const end = wallTime(Date.parse(event.end?.dateTime ?? event.start!.dateTime!), zone);
    startDate = wallDate(start);
    endDate = wallDate(end);
    startTime = wallClock(start);
    endTime = wallClock(end);
  }
  const overrides = event.reminders?.overrides ?? [];
  return {
    calendarId,
    title: event.summary ?? "",
    allDay,
    startDate,
    startTime,
    endDate,
    endTime,
    zone,
    location: event.location ?? "",
    description: event.description ?? "",
    colorId: event.colorId ?? "",
    ...splitRecurrence(recurrence, dayOfIso(startDate)),
    reminders:
      !event.reminders || event.reminders.useDefault
        ? "default"
        : overrides.filter((item) => item.method === "popup").map((item) => item.minutes),
    guests: (event.attendees ?? [])
      .filter((attendee) => !attendee.self && !attendee.resource)
      .map((attendee) => attendee.email),
    meet: Boolean(meetLink(event)),
    visibility:
      event.visibility === "public" || event.visibility === "private"
        ? event.visibility
        : "default",
    busy: event.transparency !== "transparent",
  };
};

/** The editor's fields for a new event over `start`–`end` (grid times). */
export const draftForNew = ({
  calendarId,
  start,
  end,
  allDay,
  title = "",
  reminder,
}: {
  calendarId: string;
  start: string;
  end: string;
  allDay: boolean;
  title?: string;
  /** The defaultReminder setting. */
  reminder: string;
}): Draft => {
  const zone = localZone();
  const draft = draftFromEvent(
    calendarId,
    allDay
      ? {
          id: "",
          summary: title,
          start: { date: start.slice(0, 10) },
          end: { date: end.slice(0, 10) },
        }
      : {
          id: "",
          summary: title,
          start: { dateTime: start, timeZone: zone },
          end: { dateTime: end, timeZone: zone },
        },
    null,
  );
  const minutes = Number(reminder);
  return {
    ...draft,
    reminders:
      reminder === "none"
        ? []
        : Number.isFinite(minutes) && reminder !== "calendar"
          ? [minutes]
          : "default",
  };
};

/** Why the fields can't be saved, or null. */
export const draftProblem = (draft: Draft) => {
  const times = draftTimes(draft);
  if (!times) return "Pick a start and an end.";
  if (
    draft.allDay
      ? times.end.date! <= times.start.date!
      : Date.parse(times.end.dateTime!) < Date.parse(times.start.dateTime!)
  )
    return "The event ends before it starts.";
  if (
    draft.repeat === "custom" &&
    !/^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[A-Z0-9,+-]+)*$/i.test(
      draft.rule.trim().replace(/^RRULE:/i, ""),
    )
  )
    return "The custom repeat rule isn't one Google takes, such as FREQ=WEEKLY;BYDAY=MO,TH.";
  const bad = draft.guests.find((guest) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest));
  if (bad) return `${bad} isn't an email address.`;
  return null;
};

const draftTimes = (draft: Draft) => {
  if (draft.allDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(draft.endDate))
      return null;
    return {
      start: { date: draft.startDate, dateTime: null, timeZone: null },
      end: { date: isoDay(dayOfIso(draft.endDate) + 1), dateTime: null, timeZone: null },
    };
  }
  const start = parseWall(draft.startDate, draft.startTime);
  const end = parseWall(draft.endDate, draft.endTime);
  if (!start || !end) return null;
  const at = (wall: NonNullable<typeof start>) =>
    new Date(zonedInstant(wall, draft.zone)).toISOString().replace(/\.000Z$/, "Z");
  return {
    start: { dateTime: at(start), timeZone: draft.zone, date: null },
    end: { dateTime: at(end), timeZone: draft.zone, date: null },
  };
};

/** The series' recurrence lines the fields make, or null for an event that doesn't repeat. */
export const draftRecurrence = (draft: Draft) => {
  if (draft.repeat === "none") return null;
  const rule =
    draft.repeat === "custom"
      ? draft.rule.trim().replace(/^RRULE:/i, "")
      : presetRule(draft.repeat, dayOfIso(draft.startDate));
  return [`RRULE:${rule}`, ...draft.otherRecurrence];
};

const newRequestId = () =>
  `loam-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Every field the editor sets, as Google takes it; `attendees` keeps the guests' answers. */
const fullBody = (draft: Draft, existing: GAttendee[]): Partial<GEvent> => {
  const times = draftTimes(draft)!;
  const known = new Map(existing.map((attendee) => [attendee.email.toLowerCase(), attendee]));
  const self = existing.filter((attendee) => attendee.self || attendee.resource);
  const guests = draft.guests.map((email) => known.get(email.toLowerCase()) ?? { email });
  return {
    summary: draft.title.trim(),
    start: times.start,
    end: times.end,
    location: draft.location,
    description: draft.description,
    colorId: draft.colorId || null,
    recurrence: draftRecurrence(draft),
    reminders:
      draft.reminders === "default"
        ? { useDefault: true }
        : {
            useDefault: false,
            overrides: draft.reminders.map((minutes) => ({ method: "popup" as const, minutes })),
          },
    attendees: guests.length ? [...self, ...guests] : self,
    visibility: draft.visibility,
    transparency: draft.busy ? "opaque" : "transparent",
  };
};

/**
 * What to send Google for the fields: everything for a new event, else only what changed
 * from `before`. `conference` says whether the body adds or removes a Meet link, which needs
 * conferenceDataVersion=1.
 */
export const draftChanges = (
  draft: Draft,
  before: Draft | null,
  existing: GAttendee[] = [],
): { body: Partial<GEvent>; conference: boolean } => {
  const next = fullBody(draft, existing) as Record<string, unknown>;
  const body: Record<string, unknown> = {};
  if (before) {
    const old = fullBody(before, existing) as Record<string, unknown>;
    for (const [field, value] of Object.entries(next))
      if (JSON.stringify(value) !== JSON.stringify(old[field])) body[field] = value;
  } else
    for (const [field, value] of Object.entries(next))
      if (value !== null && value !== "" && !(Array.isArray(value) && !value.length))
        body[field] = value;
  let conference = false;
  if (draft.meet && !before?.meet) {
    body.conferenceData = {
      createRequest: { requestId: newRequestId(), conferenceSolutionKey: { type: "hangoutsMeet" } },
    };
    conference = true;
  } else if (!draft.meet && before?.meet) {
    body.conferenceData = null;
    conference = true;
  }
  return { body: body as Partial<GEvent>, conference };
};

/** Whether the change touches guests, so Google asks whether to email them. */
export const hasGuests = (draft: Draft, before: Draft | null) =>
  draft.guests.length > 0 || (before?.guests.length ?? 0) > 0;

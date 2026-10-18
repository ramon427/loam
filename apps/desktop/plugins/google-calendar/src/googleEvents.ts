import { dayNumber, localMidnight } from "./dates";

/*
 * Google Calendar's resources as the plugin reads and writes them
 * (https://developers.google.com/workspace/calendar/api/v3/reference), and what the calendar
 * draws from them: times, colors, and whether the user may change an event.
 */

/** A date (all-day) or a date-time with its zone. */
export type GDate = { date?: string | null; dateTime?: string | null; timeZone?: string | null };

export type GAttendee = {
  email: string;
  displayName?: string;
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
  self?: boolean;
  organizer?: boolean;
  optional?: boolean;
  resource?: boolean;
};

export type GReminders = {
  useDefault: boolean;
  overrides?: { method: "popup" | "email"; minutes: number }[];
};

export type GEvent = {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  etag?: string;
  htmlLink?: string;
  iCalUID?: string;
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string | null;
  start?: GDate;
  end?: GDate;
  recurrence?: string[] | null;
  recurringEventId?: string;
  originalStartTime?: GDate;
  attendees?: GAttendee[];
  organizer?: { email?: string; displayName?: string; self?: boolean };
  guestsCanModify?: boolean;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string; label?: string }[];
    createRequest?: { requestId: string; conferenceSolutionKey: { type: string } };
  } | null;
  reminders?: GReminders;
  visibility?: "default" | "public" | "private" | "confidential";
  transparency?: "opaque" | "transparent";
  eventType?: string;
  locked?: boolean;
};

export type GCalendar = {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  accessRole?: "owner" | "writer" | "reader" | "freeBusyReader";
  primary?: boolean;
  selected?: boolean;
  hidden?: boolean;
  deleted?: boolean;
  timeZone?: string;
  defaultReminders?: { method: "popup" | "email"; minutes: number }[];
};

/** Google Calendar's event colors by colorId, as its web app shows them. */
export const EVENT_COLORS: Record<string, { name: string; hex: string }> = {
  "1": { name: "Lavender", hex: "#7986cb" },
  "2": { name: "Sage", hex: "#33b679" },
  "3": { name: "Grape", hex: "#8e24aa" },
  "4": { name: "Flamingo", hex: "#e67c73" },
  "5": { name: "Banana", hex: "#f6bf26" },
  "6": { name: "Tangerine", hex: "#f4511e" },
  "7": { name: "Peacock", hex: "#039be5" },
  "8": { name: "Graphite", hex: "#616161" },
  "9": { name: "Blueberry", hex: "#3f51b5" },
  "10": { name: "Basil", hex: "#0b8043" },
  "11": { name: "Tomato", hex: "#d50000" },
};

/** The calendar list's classic colors, as Google Calendar's web app draws them today. */
const CALENDAR_COLORS: Record<string, string> = {
  "#ac725e": "#795548",
  "#d06b64": "#e67c73",
  "#f83a22": "#d50000",
  "#fa573c": "#f4511e",
  "#ff7537": "#ef6c00",
  "#ffad46": "#f09300",
  "#42d692": "#009688",
  "#16a765": "#0b8043",
  "#7bd148": "#7cb342",
  "#b3dc6c": "#c0ca33",
  "#fbe983": "#e4c441",
  "#fad165": "#f6bf26",
  "#92e1c0": "#33b679",
  "#9fe1e7": "#039be5",
  "#9fc6e7": "#4285f4",
  "#4986e7": "#3f51b5",
  "#9a9cff": "#7986cb",
  "#b99aff": "#b39ddb",
  "#c2c2c2": "#616161",
  "#cabdbf": "#a79b8e",
  "#cca6ac": "#ad1457",
  "#f691b2": "#d81b60",
  "#cd74e6": "#8e24aa",
  "#a47ae2": "#9e69af",
};

export const calendarColor = (calendar: Pick<GCalendar, "backgroundColor"> | undefined) => {
  const color = calendar?.backgroundColor?.toLowerCase() ?? "#039be5";
  return CALENDAR_COLORS[color] ?? (/^#[0-9a-f]{6}$/.test(color) ? color : "#039be5");
};

export const calendarName = (calendar: GCalendar) =>
  calendar.summaryOverride || calendar.summary || calendar.id;

export const canWrite = (calendar: GCalendar | undefined) =>
  calendar?.accessRole === "owner" || calendar?.accessRole === "writer";

/** The instant a Google start or end names; a date is the viewer's local midnight. */
export const instantOf = (time: GDate | undefined) => {
  if (time?.date) {
    const [y, m, d] = time.date.split("-").map(Number);
    return localMidnight(dayNumber(y!, m!, d!));
  }
  return time?.dateTime ? Date.parse(time.dateTime) : Number.NaN;
};

export const isAllDay = (event: Pick<GEvent, "start">) => Boolean(event.start?.date);

export const selfAttendee = (event: GEvent) => event.attendees?.find((attendee) => attendee.self);

/** The Google Meet (or other video) link, if the event has one. */
export const meetLink = (event: GEvent) =>
  event.hangoutLink ??
  event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri ??
  null;

/** Whether the user may move, change or delete it here: their calendar, and their event. */
export const isEditable = (event: GEvent, calendar: GCalendar | undefined) =>
  canWrite(calendar) &&
  !event.locked &&
  (event.eventType ?? "default") === "default" &&
  (!event.organizer || event.organizer.self === true || event.guestsCanModify === true);

export const eventColor = (event: GEvent, calendar: GCalendar | undefined) =>
  (event.colorId && EVENT_COLORS[event.colorId]?.hex) || calendarColor(calendar);

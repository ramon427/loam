import { joinLinkIn } from "./meetingLinks";
import { defineZone, readObservance, type Observance, type ZoneRules } from "./vtimezone";
import { WINDOWS_ZONES } from "./windowsZones";

/*
 * Reads an iCalendar (RFC 5545) feed, as Google Calendar's secret iCal address or Outlook's
 * published calendar serves it, into plain events. Only what the calendar shows is kept.
 *
 * Zones: an IANA TZID is used as it is. Outlook names zones the Windows way ("W. Europe
 * Standard Time"), which the CLDR's table maps to IANA. Any other name is read from the
 * feed's own VTIMEZONE block, and failing that the time is taken as the viewer's local time.
 */

/** A DATE (an all-day event's day) or a DATE-TIME in UTC, a named zone, or floating local time. */
export type IcsDate =
  | { kind: "date"; y: number; m: number; d: number }
  | {
      kind: "time";
      y: number;
      m: number;
      d: number;
      h: number;
      mi: number;
      s: number;
      /** "utc", "floating" (the viewer's own time), an IANA zone id, or a feed's zone ("vtz:…"). */
      zone: string;
    };

type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type RRule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count?: number;
  until?: IcsDate;
  /** Weekdays, Sunday = 0, each with an optional ordinal such as 2 (second) or -1 (last). */
  byDay?: { weekday: Weekday; ordinal?: number }[];
  byMonthDay?: number[];
  byMonth?: number[];
  bySetPos?: number[];
  weekStart: Weekday;
};

export type IcsEvent = {
  uid: string;
  summary: string;
  description: string;
  location: string;
  url: string;
  start: IcsDate;
  end: IcsDate | null;
  /** From DURATION, in seconds, when there is no DTEND. */
  duration: number | null;
  rrule: RRule | null;
  exdates: IcsDate[];
  rdates: IcsDate[];
  /** Set on an event that replaces one occurrence of a recurring event with the same UID. */
  recurrenceId: IcsDate | null;
  status: string;
  /** STATUS:CANCELLED, or a title Outlook starts with "Canceled:" (taken off `summary`). */
  cancelled: boolean;
  /** Outlook's X-MICROSOFT-CDO-BUSYSTATUS: BUSY, FREE, TENTATIVE, OOF or WORKINGELSEWHERE. */
  busyStatus: string;
  /** TRANSP:TRANSPARENT: the time shows as free. */
  transparent: boolean;
  /** CLASS:PRIVATE or CONFIDENTIAL: a published calendar may share only the time. */
  private: boolean;
  /** The video call to join (Teams, Meet or Zoom), from its own field or the text. */
  joinUrl: string;
  organizer: string;
  attendees: string[];
};

export type IcsCalendar = { name: string; events: IcsEvent[]; zones: ZoneRules[] };

/** An event with nothing but a start, for building one in code. */
export const blankEvent = (start: IcsDate): IcsEvent => ({
  uid: "",
  summary: "",
  description: "",
  location: "",
  url: "",
  start,
  end: null,
  duration: null,
  rrule: null,
  exdates: [],
  rdates: [],
  recurrenceId: null,
  status: "",
  cancelled: false,
  busyStatus: "",
  transparent: false,
  private: false,
  joinUrl: "",
  organizer: "",
  attendees: [],
});

type Property = { name: string; params: Record<string, string>; value: string };

const WEEKDAYS: Record<string, Weekday> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** Joins folded lines: a line break followed by a space or tab continues the line before. */
export const unfoldLines = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n")
    .filter((line) => line.length > 0);

/** Splits `NAME;PARAM=a;PARAM="b:c":value`, minding quoted parameter values. */
const parseProperty = (line: string): Property | null => {
  let quoted = false;
  let colon = -1;
  const cuts: number[] = [];
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === ";") cuts.push(index);
    else if (!quoted && char === ":") {
      colon = index;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const bounds = [-1, ...cuts, colon];
  const parts = bounds.slice(0, -1).map((from, index) => head.slice(from + 1, bounds[index + 1]));
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const equals = part.indexOf("=");
    if (equals < 0) continue;
    params[part.slice(0, equals).toUpperCase()] = part.slice(equals + 1).replace(/^"|"$/g, "");
  }
  return { name: parts[0]!.toUpperCase(), params, value: line.slice(colon + 1) };
};

/** Undoes TEXT escaping: `\n`, `\,`, `\;` and `\\`. */
const unescapeText = (value: string) =>
  value.replace(/\\([nN,;\\])/g, (_, char: string) => (char === "n" || char === "N" ? "\n" : char));

/** A DATE or DATE-TIME value; null if it can't be read. `zoneOf` resolves its TZID. */
export const parseIcsDate = (
  value: string,
  params: Record<string, string> = {},
  zoneOf: (tzid: string) => string = (tzid) => tzid,
): IcsDate | null => {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d, h, mi, s, utc] = match;
  const date = { y: Number(y), m: Number(m), d: Number(d) };
  if (date.m < 1 || date.m > 12 || date.d < 1 || date.d > 31) return null;
  if (h === undefined || params.VALUE === "DATE") return { kind: "date", ...date };
  return {
    kind: "time",
    ...date,
    h: Number(h),
    mi: Number(mi),
    s: Number(s ?? 0),
    zone: utc ? "utc" : params.TZID ? zoneOf(params.TZID) : "floating",
  };
};

/** A DURATION such as `PT1H30M`, `P1D` or `-P1W`, in seconds. */
export const parseDuration = (value: string): number | null => {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim(),
  );
  if (!match) return null;
  const [, sign, w, d, h, mi, s] = match;
  const seconds =
    Number(w ?? 0) * 604_800 +
    Number(d ?? 0) * 86_400 +
    Number(h ?? 0) * 3_600 +
    Number(mi ?? 0) * 60 +
    Number(s ?? 0);
  return sign === "-" ? -seconds : seconds;
};

const numbers = (value: string | undefined) =>
  value
    ? value
        .split(",")
        .map(Number)
        .filter((number) => Number.isInteger(number) && number !== 0)
    : undefined;

/** An RRULE value; null for a rule this reader can't follow (such as HOURLY). */
export const parseRRule = (value: string): RRule | null => {
  const parts = Object.fromEntries(
    value.split(";").map((part) => {
      const [key = "", rest = ""] = part.split("=");
      return [key.toUpperCase(), rest.toUpperCase()];
    }),
  ) as Record<string, string | undefined>;
  const freq = parts.FREQ;
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;
  const interval = Number(parts.INTERVAL ?? 1);
  const count = parts.COUNT === undefined ? undefined : Number(parts.COUNT);
  const byDay = parts.BYDAY?.split(",").flatMap((day) => {
    const match = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(day.trim());
    if (!match) return [];
    return [{ weekday: WEEKDAYS[match[2]!]!, ...(match[1] && { ordinal: Number(match[1]) }) }];
  });
  return {
    freq,
    interval: Number.isInteger(interval) && interval > 0 ? interval : 1,
    ...(count !== undefined && Number.isInteger(count) && count > 0 && { count }),
    ...(parts.UNTIL && { until: parseIcsDate(parts.UNTIL) ?? undefined }),
    ...(byDay?.length && { byDay }),
    ...(parts.BYMONTHDAY && { byMonthDay: numbers(parts.BYMONTHDAY) }),
    ...(parts.BYMONTH && { byMonth: numbers(parts.BYMONTH) }),
    ...(parts.BYSETPOS && { bySetPos: numbers(parts.BYSETPOS) }),
    weekStart: WEEKDAYS[parts.WKST ?? "MO"] ?? 1,
  };
};

const isRuntimeZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

const WINDOWS_BY_LOWER = new Map(
  Object.entries(WINDOWS_ZONES).map(([name, zone]) => [name.toLowerCase(), zone]),
);

/**
 * The zone a TZID names: itself if it is an IANA id the runtime knows, else the IANA zone for
 * a Windows name, else the feed's own definition (`defined`, by TZID), else "floating".
 */
export const resolveZone = (tzid: string, defined: ReadonlyMap<string, ZoneRules> = new Map()) => {
  const name = tzid.trim().replace(/^"|"$/g, "");
  if (/^(?:tzone:\/\/Microsoft\/)?utc$/i.test(name)) return "utc";
  // Mozilla-style ids put a path before the IANA id: /mozilla.org/20050126_1/Europe/Berlin.
  const bare = name.replace(/^\/.*?\/(?=[A-Z][A-Za-z]+\/[A-Za-z_]+$)/, "");
  if (!/\s/.test(bare) && isRuntimeZone(bare)) return bare;
  const windows = WINDOWS_BY_LOWER.get(name.toLowerCase());
  if (windows) return windows;
  return defined.get(name)?.id ?? "floating";
};

const dateList = (property: Property, zoneOf: (tzid: string) => string) =>
  property.value
    .split(",")
    .map((value) => parseIcsDate(value, property.params, zoneOf))
    .filter((date): date is IcsDate => date !== null);

/** A CN, or the address after mailto:, for an organizer or attendee. */
const personOf = (property: Property) =>
  unescapeText(property.params.CN ?? property.value.replace(/^mailto:/i, "")).trim();

/** Plain text from Outlook's HTML description (X-ALT-DESC), for when there is no DESCRIPTION. */
const htmlToText = (html: string) =>
  html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(
      /<a [^>]*href="(https:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_, href: string, text: string) =>
        text.replace(/<[^>]+>/g, "").trim() && text.trim() !== href ? `${text} (${href})` : href,
    )
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const CANCELED_PREFIX = /^\s*(?:Canceled|Cancelled)\s*:\s*/i;

/** A midnight DATE-TIME that Outlook marks as all day, as the DATE it means. */
const asDay = (date: IcsDate | null): IcsDate | null =>
  date?.kind === "time" && date.h === 0 && date.mi === 0 && date.s === 0
    ? { kind: "date", y: date.y, m: date.m, d: date.d }
    : date;

const toEvent = (properties: Property[], zoneOf: (tzid: string) => string): IcsEvent | null => {
  const event = blankEvent(null as unknown as IcsDate);
  let html = "";
  let allDayFlag = false;
  const meetingFields: string[] = [];
  for (const property of properties) {
    const date = () => parseIcsDate(property.value, property.params, zoneOf);
    switch (property.name) {
      case "UID":
        event.uid = property.value;
        break;
      case "SUMMARY":
        event.summary = unescapeText(property.value);
        break;
      case "DESCRIPTION":
        event.description = unescapeText(property.value);
        break;
      case "X-ALT-DESC":
        if (/html/i.test(property.params.FMTTYPE ?? "")) html = unescapeText(property.value);
        break;
      case "LOCATION":
        event.location = unescapeText(property.value);
        break;
      case "URL":
        event.url = property.value.trim();
        break;
      case "STATUS":
        event.status = property.value.trim().toUpperCase();
        break;
      case "TRANSP":
        event.transparent = property.value.trim().toUpperCase() === "TRANSPARENT";
        break;
      case "CLASS":
        event.private = /^(PRIVATE|CONFIDENTIAL)$/i.test(property.value.trim());
        break;
      case "X-MICROSOFT-CDO-BUSYSTATUS":
        event.busyStatus = property.value.trim().toUpperCase();
        break;
      case "X-MICROSOFT-CDO-ALLDAYEVENT":
        allDayFlag = property.value.trim().toUpperCase() === "TRUE";
        break;
      case "X-MICROSOFT-SKYPETEAMSMEETINGURL":
      case "X-MICROSOFT-ONLINEMEETINGCONFLINK":
      case "X-MICROSOFT-ONLINEMEETINGEXTERNALLINK":
      case "X-GOOGLE-CONFERENCE":
        meetingFields.push(unescapeText(property.value));
        break;
      case "ORGANIZER":
        event.organizer = personOf(property);
        break;
      case "ATTENDEE":
        if (event.attendees.length < 100) event.attendees.push(personOf(property));
        break;
      case "DTSTART":
        event.start = date() as IcsDate;
        break;
      case "DTEND":
        event.end = date();
        break;
      case "DURATION":
        event.duration = parseDuration(property.value);
        break;
      case "RRULE":
        event.rrule = parseRRule(property.value);
        break;
      case "EXDATE":
        event.exdates.push(...dateList(property, zoneOf));
        break;
      case "RDATE":
        if (property.params.VALUE !== "PERIOD") event.rdates.push(...dateList(property, zoneOf));
        break;
      case "RECURRENCE-ID":
        event.recurrenceId = date();
        break;
    }
  }
  if (!event.start) return null;
  if (allDayFlag && event.start.kind === "time") {
    event.start = asDay(event.start)!;
    event.end = asDay(event.end);
    event.exdates = event.exdates.map((day) => asDay(day)!);
    event.recurrenceId = asDay(event.recurrenceId);
  }
  if (!event.description.trim() && html) event.description = htmlToText(html);
  if (CANCELED_PREFIX.test(event.summary)) {
    event.summary = event.summary.replace(CANCELED_PREFIX, "");
    event.cancelled = true;
  }
  if (event.status === "CANCELLED") event.cancelled = true;
  event.joinUrl =
    joinLinkIn(...meetingFields, event.location, event.url, event.description)?.url ?? "";
  return event;
};

/** A VTIMEZONE block's TZID and observances, as read so far. */
type ZoneDraft = { tzid: string; observances: Observance[] };

/** Reads a feed's events, its name (X-WR-CALNAME) and its own zones, skipping what it can't read. */
export const parseIcs = (text: string): IcsCalendar => {
  let name = "";
  const rawEvents: Property[][] = [];
  const drafts: ZoneDraft[] = [];
  /** The components we are inside, innermost last. */
  const stack: string[] = [];
  let current: Property[] | null = null;
  let zone: ZoneDraft | null = null;
  let observance: { standard: boolean; properties: Property[] } | null = null;
  for (const line of unfoldLines(text)) {
    const property = parseProperty(line);
    if (!property) continue;
    if (property.name === "BEGIN") {
      const component = property.value.trim().toUpperCase();
      stack.push(component);
      if (component === "VEVENT" && stack.length === 2) current = [];
      else if (component === "VTIMEZONE" && stack.length === 2)
        zone = { tzid: "", observances: [] };
      else if ((component === "STANDARD" || component === "DAYLIGHT") && zone)
        observance = { standard: component === "STANDARD", properties: [] };
      continue;
    }
    if (property.name === "END") {
      const component = stack.pop();
      if (component === "VEVENT" && current) {
        rawEvents.push(current);
        current = null;
      } else if (component === "VTIMEZONE" && zone) {
        if (zone.tzid && zone.observances.length) drafts.push(zone);
        zone = null;
      } else if ((component === "STANDARD" || component === "DAYLIGHT") && zone && observance) {
        const read = readObservance(observance.standard, observance.properties);
        if (read) zone.observances.push(read);
        observance = null;
      }
      continue;
    }
    if (current && stack.at(-1) === "VEVENT") current.push(property);
    else if (observance) observance.properties.push(property);
    else if (zone && stack.at(-1) === "VTIMEZONE" && property.name === "TZID")
      zone.tzid = property.value.trim().replace(/^"|"$/g, "");
    else if (stack.length === 1 && property.name === "X-WR-CALNAME")
      name = unescapeText(property.value);
  }

  const defined = new Map(drafts.map((draft) => [draft.tzid, defineZone(draft.observances)]));
  const resolved = new Map<string, string>();
  const zoneOf = (tzid: string) => {
    let found = resolved.get(tzid);
    if (found === undefined) {
      found = resolveZone(tzid, defined);
      resolved.set(tzid, found);
    }
    return found;
  };
  const events = rawEvents.flatMap((properties) => toEvent(properties, zoneOf) ?? []);
  const used = new Set(resolved.values());
  return { name, events, zones: [...defined.values()].filter((rules) => used.has(rules.id)) };
};

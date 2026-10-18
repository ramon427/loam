/*
 * Reads an iCalendar (RFC 5545) feed, as Google Calendar's secret iCal address serves it, into
 * plain events. Only what the calendar pane shows is kept; VTIMEZONE blocks are skipped, since
 * Google names its zones by their IANA ids, which the runtime already knows.
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
      /** "utc", "floating" (the viewer's own time), or an IANA zone id. */
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
};

type IcsCalendar = { name: string; events: IcsEvent[] };

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

/** A DATE or DATE-TIME value; null if it can't be read. */
export const parseIcsDate = (
  value: string,
  params: Record<string, string> = {},
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
    zone: utc ? "utc" : (params.TZID ?? "floating"),
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

const dateList = (property: Property) =>
  property.value
    .split(",")
    .map((value) => parseIcsDate(value, property.params))
    .filter((date): date is IcsDate => date !== null);

const toEvent = (properties: Property[]): IcsEvent | null => {
  const event: IcsEvent = {
    uid: "",
    summary: "",
    description: "",
    location: "",
    url: "",
    start: null as unknown as IcsDate,
    end: null,
    duration: null,
    rrule: null,
    exdates: [],
    rdates: [],
    recurrenceId: null,
    status: "",
  };
  for (const property of properties) {
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
      case "LOCATION":
        event.location = unescapeText(property.value);
        break;
      case "URL":
        event.url = property.value.trim();
        break;
      case "STATUS":
        event.status = property.value.trim().toUpperCase();
        break;
      case "DTSTART":
        event.start = parseIcsDate(property.value, property.params) as IcsDate;
        break;
      case "DTEND":
        event.end = parseIcsDate(property.value, property.params);
        break;
      case "DURATION":
        event.duration = parseDuration(property.value);
        break;
      case "RRULE":
        event.rrule = parseRRule(property.value);
        break;
      case "EXDATE":
        event.exdates.push(...dateList(property));
        break;
      case "RDATE":
        if (property.params.VALUE !== "PERIOD") event.rdates.push(...dateList(property));
        break;
      case "RECURRENCE-ID":
        event.recurrenceId = parseIcsDate(property.value, property.params);
        break;
    }
  }
  return event.start ? event : null;
};

/** Reads a feed's events and its name (X-WR-CALNAME), skipping any part it can't read. */
export const parseIcs = (text: string): IcsCalendar => {
  const calendar: IcsCalendar = { name: "", events: [] };
  /** The components we are inside, innermost last. */
  const stack: string[] = [];
  let current: Property[] | null = null;
  for (const line of unfoldLines(text)) {
    const property = parseProperty(line);
    if (!property) continue;
    if (property.name === "BEGIN") {
      const component = property.value.trim().toUpperCase();
      stack.push(component);
      if (component === "VEVENT" && stack.length === 2) current = [];
      continue;
    }
    if (property.name === "END") {
      const component = stack.pop();
      if (component === "VEVENT" && current) {
        const event = toEvent(current);
        if (event) calendar.events.push(event);
        current = null;
      }
      continue;
    }
    if (current && stack.at(-1) === "VEVENT") current.push(property);
    else if (stack.length === 1 && property.name === "X-WR-CALNAME")
      calendar.name = unescapeText(property.value);
  }
  return calendar;
};

/*
 * Time zones a feed defines itself in VTIMEZONE blocks, for TZIDs the runtime doesn't know and
 * no table maps, such as Outlook's "Customized Time Zone". A zone is its STANDARD and DAYLIGHT
 * observances: each switches the offset at its DTSTART and then yearly by its RRULE (or on
 * its RDATEs). Feeds reuse names for different rules, so a zone is known by a fingerprint of
 * its rules, not its name.
 */

/** A wall-clock time, as a VTIMEZONE writes its onsets. */
type Wall = { y: number; m: number; d: number; h: number; mi: number; s: number };

export type Observance = {
  /** STANDARD rather than DAYLIGHT. */
  standard: boolean;
  /** The offset from UTC before and after the onset, in seconds. */
  offsetFrom: number;
  offsetTo: number;
  /** The first onset, in the offset before it. */
  start: Wall;
  /** A yearly rule: the month, and a weekday with its ordinal (-1 last) or a day of the month. */
  yearly: {
    month: number;
    weekday?: number;
    ordinal?: number;
    monthDay?: number;
    /** The last onset, as UTC milliseconds. */
    until?: number;
    count?: number;
  } | null;
  rdates: Wall[];
};

export type ZoneRules = { id: string; observances: Observance[] };

const WEEKDAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

const wallMs = (wall: Wall) => Date.UTC(wall.y, wall.m - 1, wall.d, wall.h, wall.mi, wall.s);

const readWall = (value: string): Wall | null => {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d, h, mi, s] = match;
  return {
    y: Number(y),
    m: Number(m),
    d: Number(d),
    h: Number(h ?? 0),
    mi: Number(mi ?? 0),
    s: Number(s ?? 0),
  };
};

/** `+0100`, `-0530` or `+010000`, in seconds. */
export const readOffset = (value: string): number | null => {
  const match = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const [, sign, h, m, s] = match;
  const seconds = Number(h) * 3600 + Number(m) * 60 + Number(s ?? 0);
  return sign === "-" ? -seconds : seconds;
};

const readYearly = (value: string): Observance["yearly"] => {
  const parts = Object.fromEntries(
    value.split(";").map((part) => {
      const [key = "", rest = ""] = part.split("=");
      return [key.trim().toUpperCase(), rest.trim().toUpperCase()];
    }),
  ) as Record<string, string | undefined>;
  // Zones change their clocks once a year; any other rule is left to DTSTART alone.
  if (parts.FREQ !== "YEARLY" || (parts.INTERVAL && parts.INTERVAL !== "1")) return null;
  const month = Number(parts.BYMONTH);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  const day = /^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(parts.BYDAY?.split(",")[0] ?? "");
  const monthDay = Number(parts.BYMONTHDAY);
  const until = parts.UNTIL ? readWall(parts.UNTIL) : null;
  const count = Number(parts.COUNT);
  return {
    month,
    ...(day && { weekday: WEEKDAYS[day[2]!]!, ordinal: Number(day[1] ?? 1) }),
    ...(!day && Number.isInteger(monthDay) && monthDay !== 0 && { monthDay }),
    ...(until && { until: wallMs(until) }),
    ...(Number.isInteger(count) && count > 0 && { count }),
  };
};

/** One observance from a STANDARD or DAYLIGHT block's properties; null if it lacks one. */
export const readObservance = (
  standard: boolean,
  properties: { name: string; value: string }[],
) => {
  let offsetFrom: number | null = null;
  let offsetTo: number | null = null;
  let start: Wall | null = null;
  let yearly: Observance["yearly"] = null;
  const rdates: Wall[] = [];
  for (const { name, value } of properties) {
    if (name === "TZOFFSETFROM") offsetFrom = readOffset(value);
    else if (name === "TZOFFSETTO") offsetTo = readOffset(value);
    else if (name === "DTSTART") start = readWall(value);
    else if (name === "RRULE") yearly = readYearly(value);
    else if (name === "RDATE")
      rdates.push(...value.split(",").flatMap((part) => readWall(part) ?? []));
  }
  if (offsetTo === null || !start) return null;
  const observance: Observance = {
    standard,
    offsetFrom: offsetFrom ?? offsetTo,
    offsetTo,
    start,
    yearly,
    rdates,
  };
  return observance;
};

/** The day of the month a yearly rule picks in `year`, or null if there is none. */
const ruleDay = (rule: NonNullable<Observance["yearly"]>, year: number, startDay: number) => {
  const length = new Date(Date.UTC(year, rule.month, 0)).getUTCDate();
  if (rule.weekday !== undefined) {
    const ordinal = rule.ordinal ?? 1;
    if (ordinal > 0) {
      const firstWeekday = new Date(Date.UTC(year, rule.month - 1, 1)).getUTCDay();
      const day = 1 + ((rule.weekday - firstWeekday + 7) % 7) + (ordinal - 1) * 7;
      return day <= length ? day : null;
    }
    const lastWeekday = new Date(Date.UTC(year, rule.month - 1, length)).getUTCDay();
    const day = length - ((lastWeekday - rule.weekday + 7) % 7) + (ordinal + 1) * 7;
    return day >= 1 ? day : null;
  }
  const wanted = rule.monthDay ?? startDay;
  const day = wanted > 0 ? wanted : length + 1 + wanted;
  return day >= 1 && day <= length ? day : null;
};

/** The instants (UTC milliseconds) an observance starts at, in the years around `year`. */
const onsets = (observance: Observance, year: number) => {
  const { start, yearly, offsetFrom } = observance;
  const at = (wall: Wall) => wallMs(wall) - offsetFrom * 1000;
  const found = [at(start), ...observance.rdates.map(at)];
  if (yearly) {
    for (let y = Math.max(start.y + 1, year - 1); y <= year + 1; y += 1) {
      if (yearly.count !== undefined && y - start.y >= yearly.count) break;
      const day = ruleDay(yearly, y, start.d);
      if (day === null) continue;
      const wall = { ...start, y, m: yearly.month, d: day };
      if (yearly.until !== undefined && wallMs(wall) - offsetFrom * 1000 > yearly.until) break;
      found.push(at(wall));
    }
  }
  return found;
};

/** How far the zone is ahead of UTC at `instant`, in milliseconds. */
export const rulesOffset = (rules: ZoneRules, instant: number) => {
  const year = new Date(instant).getUTCFullYear();
  let latest = -Infinity;
  let offset: number | null = null;
  for (const observance of rules.observances)
    for (const onset of onsets(observance, year))
      if (onset <= instant && onset > latest) {
        latest = onset;
        offset = observance.offsetTo;
      }
  if (offset === null) {
    // Before every onset (Outlook starts its rules in 1601): standard time, else the offset
    // the earliest onset changes from.
    const earliest = [...rules.observances].sort((a, b) => wallMs(a.start) - wallMs(b.start))[0];
    offset =
      rules.observances.find((observance) => observance.standard)?.offsetTo ??
      earliest?.offsetFrom ??
      0;
  }
  return offset * 1000;
};

/** A short, stable fingerprint of a zone's rules, so feeds that reuse a name don't collide. */
const fingerprint = (observances: Observance[]) => {
  const text = JSON.stringify(observances);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1)
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  return hash.toString(36);
};

const known = new Map<string, ZoneRules>();

/** The zone id dates in it carry: `vtz:` and its fingerprint. Registers the rules under it. */
export const defineZone = (observances: Observance[]): ZoneRules => {
  const rules = { id: `vtz:${fingerprint(observances)}`, observances };
  known.set(rules.id, rules);
  return rules;
};

/** Makes zones read from a feed earlier (such as from the cache) known again. */
export const restoreZones = (zones: readonly ZoneRules[]) => {
  for (const zone of zones) if (zone.id.startsWith("vtz:")) known.set(zone.id, zone);
};

export const zoneRules = (id: string) => known.get(id) ?? null;

/** The instant a wall-clock time in these rules names; two passes settle times near a change. */
export const rulesInstant = (rules: ZoneRules, wall: Wall) => {
  const ms = wallMs(wall);
  const first = ms - rulesOffset(rules, ms);
  return ms - rulesOffset(rules, first);
};

import type { GCalendar, GEvent } from "../googleEvents";

/*
 * A Google Calendar API for tests, in memory: the calendar list, events with recurring ones
 * expanded into instances, exceptions, sync tokens (and 410 Gone for an old one), pages,
 * ETags with If-Match (412 when the event changed), Google Meet links, and failures on
 * request. The plugin's unit tests call `handle` directly; the end-to-end tests serve it over
 * HTTP. Recurring events repeat DAILY or WEEKLY (INTERVAL, COUNT, UNTIL, BYDAY), in UTC.
 */

export type FakeRequest = {
  method: string;
  /** Under /calendar/v3, such as `/calendars/primary/events`. */
  path: string;
  query: Record<string, string | string[]>;
  headers: Record<string, string>;
  body: string;
};

export type FakeResponse = { status: number; headers: Record<string, string>; body: string };

type Stored = GEvent & { calendarId: string; seq: number };

const DAY = 86_400_000;
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const json = (
  status: number,
  value: unknown,
  headers: Record<string, string> = {},
): FakeResponse => ({
  status,
  headers: { "content-type": "application/json", ...headers },
  body: value === null ? "" : JSON.stringify(value),
});

const failure = (status: number, reason: string, message: string) =>
  json(status, { error: { code: status, message, errors: [{ reason, message }] } });

const pad = (value: number, length = 2) => String(value).padStart(length, "0");
const icsUtc = (instant: number) => {
  const date = new Date(instant);
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
};
const icsDay = (instant: number) => icsUtc(instant).slice(0, 8);
const isoDay = (instant: number) => new Date(instant).toISOString().slice(0, 10);

/** A start or end as an instant: a date is UTC midnight here, as the fake keeps days in UTC. */
const instant = (time: GEvent["start"]) =>
  time?.date ? Date.parse(`${time.date}T00:00:00Z`) : Date.parse(time?.dateTime ?? "");

const parseUntil = (value: string) => {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(value);
  if (!match) return Number.POSITIVE_INFINITY;
  const [, y, m, d, h = "23", mi = "59", s = "59"] = match;
  return Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(mi), Number(s));
};

/** The starts a DAILY or WEEKLY rule makes from `start`, up to `limit` of them. */
const expandRule = (start: number, recurrence: string[], limit = 800) => {
  const line = recurrence.find((item) => item.toUpperCase().startsWith("RRULE:"));
  if (!line) return [start];
  const parts = Object.fromEntries(
    line
      .slice(6)
      .split(";")
      .map((part) => part.split("=") as [string, string]),
  );
  const interval = Number(parts.INTERVAL ?? 1);
  const count = parts.COUNT ? Number(parts.COUNT) : Number.POSITIVE_INFINITY;
  const until = parts.UNTIL ? parseUntil(parts.UNTIL) : Number.POSITIVE_INFINITY;
  const starts: number[] = [];
  const timeOfDay = start - Math.floor(start / DAY) * DAY;
  if (parts.FREQ === "WEEKLY") {
    const days = (parts.BYDAY ? parts.BYDAY.split(",") : [WEEKDAYS[new Date(start).getUTCDay()]!])
      .map((day: string) => WEEKDAYS.indexOf(day.slice(-2)))
      .sort((a: number, b: number) => a - b);
    const weekStart = Math.floor(start / DAY) * DAY - new Date(start).getUTCDay() * DAY;
    for (let week = 0; starts.length < Math.min(count, limit) && week < limit; week += interval) {
      for (const day of days) {
        const at = weekStart + (week * 7 + day) * DAY + timeOfDay;
        if (at < start) continue;
        if (at > until || starts.length >= Math.min(count, limit)) break;
        starts.push(at);
      }
      if (weekStart + week * 7 * DAY > until) break;
    }
    return starts;
  }
  for (let index = 0; starts.length < Math.min(count, limit); index += 1) {
    const at = start + index * interval * DAY;
    if (at > until) break;
    starts.push(at);
  }
  return starts;
};

export const createFakeGoogleCalendar = ({
  calendars = [
    {
      id: "me@example.com",
      summary: "me@example.com",
      backgroundColor: "#9fe1e7",
      accessRole: "owner",
      primary: true,
      selected: true,
      timeZone: "UTC",
    },
  ],
  pageSize = 250,
}: { calendars?: GCalendar[]; pageSize?: number } = {}) => {
  const stored = new Map<string, Stored>();
  const key = (calendarId: string, id: string) => `${calendarId}\u0000${id}`;
  let seq = 1;
  let ids = 0;
  /** Instance-level changes, for incremental sync: what each id looked like after `seq`. */
  const log: { seq: number; calendarId: string; event: GEvent }[] = [];
  let oldestToken = 0;
  const failures: { status: number; reason: string; method?: string }[] = [];
  const requests: FakeRequest[] = [];

  const calendarOf = (id: string) =>
    id === "primary"
      ? calendars.find((calendar) => calendar.primary)
      : calendars.find((c) => c.id === id);

  const publicEvent = (event: Stored): GEvent => {
    const { calendarId: _calendarId, seq: eventSeq, ...rest } = event;
    return { ...rest, etag: `"${eventSeq}"` };
  };

  /** The instances a master makes (with its exceptions in place), or the event itself. */
  const instancesOf = (calendarId: string, master: Stored): GEvent[] => {
    if (!master.recurrence?.length) return [publicEvent(master)];
    if (master.status === "cancelled") return [];
    const allDay = Boolean(master.start?.date);
    const length = instant(master.end) - instant(master.start);
    return expandRule(instant(master.start), master.recurrence).flatMap((start) => {
      const id = `${master.id}_${allDay ? icsDay(start) : icsUtc(start)}`;
      const exception = stored.get(key(calendarId, id));
      if (exception) return exception.status === "cancelled" ? [] : [publicEvent(exception)];
      const time = (at: number) =>
        allDay
          ? { date: isoDay(at) }
          : { dateTime: new Date(at).toISOString(), timeZone: master.start?.timeZone ?? "UTC" };
      const { recurrence: _recurrence, ...fields } = publicEvent(master);
      return [
        {
          ...fields,
          id,
          recurringEventId: master.id,
          originalStartTime: time(start),
          start: time(start),
          end: time(start + length),
        },
      ];
    });
  };

  const expanded = (calendarId: string) =>
    [...stored.values()]
      .filter((event) => event.calendarId === calendarId && !event.recurringEventId)
      .flatMap((event) =>
        event.status === "cancelled" && !event.recurrence?.length
          ? []
          : instancesOf(calendarId, event),
      );

  /** Records what changed between two expansions of a series (or one event), for sync. */
  const record = (calendarId: string, before: GEvent[], after: GEvent[]) => {
    seq += 1;
    const now = new Map(after.map((event) => [event.id, event]));
    for (const event of before)
      if (!now.has(event.id))
        log.push({
          seq,
          calendarId,
          event: { id: event.id, status: "cancelled", recurringEventId: event.recurringEventId },
        });
    for (const event of after) log.push({ seq, calendarId, event });
  };

  const seriesSnapshot = (calendarId: string, id: string) => {
    const event = stored.get(key(calendarId, id));
    if (!event) return [];
    const master = event.recurringEventId
      ? stored.get(key(calendarId, event.recurringEventId))
      : event;
    return master ? instancesOf(calendarId, master) : [];
  };

  /** Runs a change and logs the instances it changed. */
  const change = <T>(calendarId: string, id: string, run: () => T) => {
    const masterId = id.includes("_") && !stored.has(key(calendarId, id)) ? id.split("_")[0]! : id;
    const target = stored.get(key(calendarId, id))?.recurringEventId ?? masterId;
    const before = seriesSnapshot(calendarId, target);
    const result = run();
    const after = seriesSnapshot(calendarId, target);
    record(calendarId, before, after);
    return result;
  };

  const strip = (event: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(event)) {
      if (value === null) continue;
      if (
        (field === "start" || field === "end" || field === "originalStartTime") &&
        value &&
        typeof value === "object"
      )
        out[field] = Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null));
      else out[field] = value;
    }
    return out;
  };

  const withConference = (event: Record<string, unknown>, version: string | undefined) => {
    const conference = event.conferenceData as GEvent["conferenceData"];
    if (version === "1" && conference?.createRequest) {
      const uri = `https://meet.google.com/fak-${(ids += 1).toString().padStart(4, "0")}-xyz`;
      return {
        ...event,
        hangoutLink: uri,
        conferenceData: { entryPoints: [{ entryPointType: "video", uri, label: uri.slice(8) }] },
      };
    }
    return event;
  };

  /** A stored event, or the instance of a series an id names. */
  const find = (calendarId: string, id: string): Stored | null => {
    const event = stored.get(key(calendarId, id));
    if (event) return event;
    const masterId = id.split("_")[0]!;
    const master = stored.get(key(calendarId, masterId));
    if (!master?.recurrence?.length) return null;
    const instance = instancesOf(calendarId, master).find((item) => item.id === id);
    return instance ? { ...(instance as GEvent), calendarId, seq: master.seq } : null;
  };

  const list = (calendarId: string, query: FakeRequest["query"]) => {
    const one = (name: string) =>
      (Array.isArray(query[name]) ? query[name][0] : query[name]) as string | undefined;
    if (one("iCalUID"))
      return json(200, {
        items: [...stored.values()]
          .filter(
            (event) =>
              event.calendarId === calendarId &&
              event.iCalUID === one("iCalUID") &&
              event.status !== "cancelled",
          )
          .map(publicEvent),
      });
    const syncToken = one("syncToken");
    let items: GEvent[];
    if (syncToken) {
      const since = Number(syncToken.replace("sync-", ""));
      if (!Number.isFinite(since) || since < oldestToken)
        return failure(
          410,
          "fullSyncRequired",
          "Sync token is no longer valid, a full sync is required.",
        );
      const latest = new Map<string, GEvent>();
      for (const entry of log)
        if (entry.calendarId === calendarId && entry.seq > since)
          latest.set(entry.event.id, entry.event);
      items = [...latest.values()];
    } else {
      const from = one("timeMin") ? Date.parse(one("timeMin")!) : Number.NEGATIVE_INFINITY;
      const to = one("timeMax") ? Date.parse(one("timeMax")!) : Number.POSITIVE_INFINITY;
      items = expanded(calendarId)
        .filter((event) => instant(event.start) < to && instant(event.end) > from)
        .sort((a, b) => instant(a.start) - instant(b.start));
    }
    const offset = Number(one("pageToken") ?? 0);
    const size = Math.min(pageSize, Number(one("maxResults") ?? 250));
    const page = items.slice(offset, offset + size);
    const more = offset + size < items.length;
    return json(200, {
      kind: "calendar#events",
      items: page,
      ...(more ? { nextPageToken: String(offset + size) } : { nextSyncToken: `sync-${seq}` }),
    });
  };

  const handle = (request: FakeRequest): FakeResponse => {
    requests.push(request);
    const forced = failures.findIndex((item) => !item.method || item.method === request.method);
    if (forced !== -1) {
      const [item] = failures.splice(forced, 1);
      return failure(item!.status, item!.reason, `Forced ${item!.status}`);
    }
    const parts = request.path.split("/").filter(Boolean).map(decodeURIComponent);
    const version = Array.isArray(request.query.conferenceDataVersion)
      ? request.query.conferenceDataVersion[0]
      : request.query.conferenceDataVersion;

    if (parts[0] === "users" && parts[1] === "me" && parts[2] === "calendarList") {
      if (parts[3]) {
        const calendar = calendarOf(parts[3]);
        return calendar ? json(200, calendar) : failure(404, "notFound", "Not Found");
      }
      return json(200, { items: calendars });
    }
    if (parts[0] !== "calendars" || parts[2] !== "events")
      return failure(404, "notFound", "Not Found");
    const calendar = calendarOf(parts[1]!);
    if (!calendar) return failure(404, "notFound", "Not Found");
    const calendarId = calendar.id;
    const eventId = parts[3];

    if (!eventId && request.method === "GET") return list(calendarId, request.query);
    if (!eventId && request.method === "POST") {
      const body = JSON.parse(request.body) as Record<string, unknown>;
      const id = typeof body.id === "string" ? body.id : `evt${(ids += 1).toString(36)}`;
      const event = {
        ...(strip(withConference(body, version)) as GEvent),
        id,
        iCalUID: `${id}@google.com`,
        htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
        status: "confirmed" as const,
        organizer: { email: calendarId, self: true },
        calendarId,
        seq: seq + 1,
      };
      change(calendarId, id, () => stored.set(key(calendarId, id), event));
      return json(200, publicEvent(stored.get(key(calendarId, id))!));
    }
    if (!eventId) return failure(405, "badRequest", "Method not allowed");

    const current = find(calendarId, eventId);
    if (!current) return failure(404, "notFound", "Not Found");
    const ifMatch = request.headers["if-match"];
    if (ifMatch && ifMatch !== `"${current.seq}"` && request.method !== "GET")
      return failure(412, "conditionNotMet", "Precondition Failed");

    if (request.method === "GET") return json(200, publicEvent(current));
    if (request.method === "PATCH" || request.method === "PUT") {
      const body = JSON.parse(request.body) as Record<string, unknown>;
      const next = change(calendarId, eventId, () => {
        const merged = strip({
          ...(request.method === "PUT"
            ? {
                id: current.id,
                recurringEventId: current.recurringEventId,
                originalStartTime: current.originalStartTime,
              }
            : current),
          ...withConference(body, version),
        }) as Stored;
        const saved: Stored = {
          ...merged,
          calendarId,
          seq: seq + 1,
          iCalUID: current.iCalUID ?? `${current.id}@google.com`,
          htmlLink: current.htmlLink ?? `https://www.google.com/calendar/event?eid=${current.id}`,
        };
        stored.set(key(calendarId, eventId), saved);
        return saved;
      });
      return json(200, publicEvent(next));
    }
    if (request.method === "DELETE") {
      if (current.status === "cancelled")
        return failure(410, "deleted", "Resource has been deleted");
      change(calendarId, eventId, () => {
        stored.set(key(calendarId, eventId), {
          ...current,
          status: "cancelled",
          calendarId,
          seq: seq + 1,
        });
        // A deleted series takes its exceptions with it.
        if (current.recurrence?.length)
          for (const [storedKey, event] of stored)
            if (event.calendarId === calendarId && event.recurringEventId === eventId)
              stored.set(storedKey, { ...event, status: "cancelled" });
      });
      return json(204, null);
    }
    return failure(405, "badRequest", "Method not allowed");
  };

  return {
    handle,
    requests,
    /** Adds an event as if it were made in Google Calendar; returns it as the API does. */
    add(calendarId: string, event: Partial<GEvent> & Pick<GEvent, "start" | "end">) {
      const id = event.id ?? `seed${(ids += 1).toString(36)}`;
      change(calendarId, id, () =>
        stored.set(key(calendarId, id), {
          summary: "",
          status: "confirmed",
          organizer: { email: calendarId, self: true },
          ...event,
          id,
          iCalUID: `${id}@google.com`,
          htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
          calendarId,
          seq: seq + 1,
        } as Stored),
      );
      return publicEvent(stored.get(key(calendarId, id))!);
    },
    /** The events as stored: singles, series and exceptions, deleted ones included. */
    stored(calendarId: string) {
      return [...stored.values()]
        .filter((event) => event.calendarId === calendarId)
        .map(publicEvent);
    },
    /** The instances in a calendar now, as a full list would show them. */
    instances(calendarId: string) {
      return expanded(calendarId);
    },
    /** Makes every sync token handed out so far answer 410 Gone. */
    expireSyncTokens() {
      oldestToken = seq + 1;
      seq += 1;
    },
    /** Answers the next request (of `method`, if given) with this failure. */
    failNext(status: number, reason = "backendError", method?: string) {
      failures.push({ status, reason, method });
    },
  };
};

export type FakeGoogleCalendar = ReturnType<typeof createFakeGoogleCalendar>;

/** The fake as the plugin's `send`, the way the main process passes a request on. */
export const sendTo =
  (fake: FakeGoogleCalendar) =>
  async (request: {
    method?: string;
    path: string;
    query?: Record<string, string | number | boolean | (string | number)[]>;
    body?: string;
    headers?: Record<string, string>;
  }) => {
    const query: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(request.query ?? {}))
      query[name] = Array.isArray(value) ? value.map(String) : String(value);
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers ?? {}))
      headers[name.toLowerCase()] = value;
    return fake.handle({
      method: request.method ?? "GET",
      path: request.path,
      query,
      headers,
      body: request.body ?? "",
    });
  };

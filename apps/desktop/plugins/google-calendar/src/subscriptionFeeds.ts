import { localDay, toInstant } from "./dates";
import type { GCalendar, GEvent } from "./googleEvents";
import { parseIcs, type IcsEvent } from "./ics";
import { isoDay, type Entry } from "./model";
import { occurrencesBetween, type Occurrence } from "./recurrence";
import { providerOf, urlProblem, type Subscription } from "./subscriptions";
import { restoreZones, type ZoneRules } from "./vtimezone";

/*
 * The subscribed calendars' events: each feed fetched (following redirects to hosts the
 * plugin may reach), parsed, and kept in the plugin store as `feed:<id>`, so the calendar
 * shows the last good copy at startup and offline. A feed that fails keeps its last copy and
 * says why, without holding up the others.
 *
 * This is the calendar's read-only source. An account that can also write (Google here; a
 * Microsoft 365 sign-in could be another) gives entries of the same shape, which the view
 * merges with these.
 */

type Response = { status: number; headers: Record<string, string>; body: string };

export type FeedFetch = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<Response>;

type FeedStore = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<unknown>;
};

export type FeedState = {
  /** The feed's own name (X-WR-CALNAME). */
  name: string;
  events: IcsEvent[];
  zones: ZoneRules[];
  /** When the events were last read, or null if never. */
  fetchedAt: number | null;
  /** When the feed was last asked for, successfully or not. */
  checkedAt: number;
  error: string | null;
};

type Cached = { name: string; fetchedAt: number; events: IcsEvent[]; zones: ZoneRules[] };

const REDIRECTS = 3;
/** Events that ended this long ago aren't kept in the cache, which shares the store's 1 MB. */
const CACHE_PAST_MS = 62 * 86_400_000;
const CACHE_BYTES = 300_000;

const time = (instant: number) =>
  new Date(instant).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** Why a feed couldn't be read, in words that point at the fix. */
const problemText = (subscription: Subscription, status: number | "unreachable" | "not-ics") => {
  const name = subscription.name;
  const outlook = providerOf(subscription.url) === "outlook";
  if (status === "unreachable") return `Couldn't reach ${name}. Check your connection.`;
  if (status === "not-ics")
    return `Couldn't load ${name}: the link doesn't lead to a calendar. Copy the ICS link, not the HTML one.`;
  if (status === 401 || status === 403 || status === 404 || status === 410)
    return outlook
      ? `Couldn't load ${name}. The link may be disabled by your organisation, or the calendar is no longer published.`
      : `Couldn't load ${name}. The link may have been reset; copy it again.`;
  return `Couldn't load ${name}: the server answered ${status}.`;
};

const headerOf = (headers: Record<string, string>, name: string) =>
  Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];

/** A feed's text, following redirects; a string is the problem when it can't be read. */
const download = async (
  fetch: FeedFetch,
  subscription: Subscription,
): Promise<{ text: string } | { problem: string }> => {
  let url = subscription.url;
  for (let hop = 0; hop <= REDIRECTS; hop += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: "text/calendar, text/plain;q=0.8, */*;q=0.5" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not granted/i.test(message))
        return {
          problem: `Loam's calendar may not reach ${new URL(url).hostname} yet. Review its permissions in Settings, Plugins.`,
        };
      if (/over 5 MB/i.test(message))
        return { problem: `${subscription.name} is over 5 MB, more than Loam reads.` };
      return { problem: problemText(subscription, "unreachable") };
    }
    const location = headerOf(response.headers, "location");
    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, url).href;
      if (urlProblem(next))
        return {
          problem: `Couldn't load ${subscription.name}: the link moves to ${new URL(next).hostname}, which Loam can't read.`,
        };
      url = next;
      continue;
    }
    if (response.status !== 200) return { problem: problemText(subscription, response.status) };
    if (!/BEGIN:VCALENDAR/i.test(response.body.slice(0, 2000)))
      return { problem: problemText(subscription, "not-ics") };
    return { text: response.body };
  }
  return { problem: `Couldn't load ${subscription.name}: the link redirects too often.` };
};

const endOf = (event: IcsEvent) => toInstant(event.end ?? event.start);

/** What is worth keeping for the calendar to show offline: not long-past one-off events. */
const forCache = (state: FeedState, now: number): Cached => {
  const events = state.events
    .filter(
      (event) =>
        event.rrule !== null || event.rdates.length > 0 || endOf(event) > now - CACHE_PAST_MS,
    )
    .map((event) => ({
      ...event,
      description: event.description.slice(0, 2000),
      attendees: event.attendees.slice(0, 30),
    }));
  return { name: state.name, fetchedAt: state.fetchedAt ?? now, events, zones: state.zones };
};

/** The cache, made to fit: without descriptions if need be, else nothing. */
const fitted = (cached: Cached): Cached | null => {
  if (JSON.stringify(cached).length <= CACHE_BYTES) return cached;
  const lean = {
    ...cached,
    events: cached.events.map((event) => ({ ...event, description: "", attendees: [] })),
  };
  return JSON.stringify(lean).length <= CACHE_BYTES ? lean : null;
};

/** The label for an event a published calendar shares only as busy time. */
const BUSY_LABELS: Record<string, string> = {
  FREE: "Free",
  TENTATIVE: "Tentative",
  OOF: "Away",
  WORKINGELSEWHERE: "Working elsewhere",
};
const untitled = (event: IcsEvent) => BUSY_LABELS[event.busyStatus] ?? "Busy";

/**
 * A description as plain text that reads well: Outlook's `<https://…>` links in brackets
 * (which would read as tags), and without its lines of underscores.
 */
const readable = (description: string) =>
  description
    .replace(/<(https?:\/\/[^\s>]+)>/g, " ($1)")
    .replace(/^_{8,}$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** A subscription as the calendar list knows it: a calendar the user can only read. */
export const subscriptionCalendar = (subscription: Subscription): GCalendar => ({
  id: `sub:${subscription.id}`,
  summary: subscription.name,
  backgroundColor: subscription.color,
  accessRole: "reader",
});

/** Occurrences of a subscription's events as the view's entries, in Google's shape. */
export const subscriptionEntries = (
  subscription: Subscription,
  items: readonly Occurrence[],
): Entry[] => {
  const calendar = subscriptionCalendar(subscription);
  return items.map((item) => {
    const source = item.event;
    const event: GEvent = {
      id: `${source.uid}@${item.start}`,
      summary: source.summary || untitled(source),
      location: source.location,
      description: readable(source.description),
      start: item.allDay
        ? { date: isoDay(localDay(item.start)) }
        : { dateTime: new Date(item.start).toISOString() },
      end: item.allDay
        ? { date: isoDay(Math.max(localDay(item.end), localDay(item.start) + 1)) }
        : { dateTime: new Date(Math.max(item.end, item.start)).toISOString() },
      status: source.busyStatus === "TENTATIVE" ? "tentative" : "confirmed",
      transparency: source.transparent || source.busyStatus === "FREE" ? "transparent" : "opaque",
      visibility: source.private ? "private" : "default",
      ...(source.organizer && { organizer: { displayName: source.organizer } }),
      attendees: source.attendees.map((name) => ({ email: name, displayName: name })),
      ...((source.rrule || source.recurrenceId) && { recurringEventId: source.uid }),
    };
    return {
      key: `${subscription.id}/${event.id}`,
      calendarId: calendar.id,
      calendar,
      event,
      extra: {
        cancelled: source.cancelled,
        private: source.private,
        busyStatus: source.busyStatus,
        joinUrl: source.joinUrl,
      },
    };
  });
};

export const createSubscriptionFeeds = ({
  fetch,
  store,
  now = Date.now,
}: {
  fetch: FeedFetch;
  store: FeedStore;
  now?: () => number;
}) => {
  const states = new Map<string, FeedState>();
  const loading = new Map<string, Promise<void>>();

  const load = async (subscription: Subscription) => {
    const result = await download(fetch, subscription);
    const before = states.get(subscription.id);
    const at = now();
    if ("problem" in result) {
      states.set(subscription.id, {
        name: before?.name ?? "",
        events: before?.events ?? [],
        zones: before?.zones ?? [],
        fetchedAt: before?.fetchedAt ?? null,
        checkedAt: at,
        error: before?.fetchedAt
          ? `${result.problem} Showing the copy from ${time(before.fetchedAt)}.`
          : result.problem,
      });
      return;
    }
    const calendar = parseIcs(result.text);
    const state: FeedState = {
      name: calendar.name,
      events: calendar.events,
      zones: calendar.zones,
      fetchedAt: at,
      checkedAt: at,
      error: null,
    };
    states.set(subscription.id, state);
    const cached = fitted(forCache(state, at));
    // A feed too big to keep is simply read afresh next time.
    await store.set(`feed:${subscription.id}`, cached).catch(() => undefined);
  };

  return {
    state: (id: string) => states.get(id) ?? null,

    /** Whether a feed is being fetched now. */
    loading: (id: string) => loading.has(id),

    /** Reads the cached copies of feeds not read yet this session. */
    async restore(list: readonly Subscription[]) {
      await Promise.all(
        list
          .filter((subscription) => !states.has(subscription.id))
          .map(async (subscription) => {
            const cached = await store.get<Cached>(`feed:${subscription.id}`).catch(() => null);
            if (!cached || !Array.isArray(cached.events) || states.has(subscription.id)) return;
            restoreZones(cached.zones ?? []);
            states.set(subscription.id, {
              name: cached.name ?? "",
              events: cached.events,
              zones: cached.zones ?? [],
              fetchedAt: cached.fetchedAt ?? null,
              checkedAt: 0,
              error: null,
            });
          }),
      );
    },

    /** Fetches the switched-on feeds last asked for more than `maxAge` ago, all at once. */
    async refresh(list: readonly Subscription[], { maxAge }: { maxAge: number }) {
      await Promise.all(
        list
          .filter((subscription) => subscription.enabled)
          .filter((subscription) => now() - (states.get(subscription.id)?.checkedAt ?? 0) >= maxAge)
          .map((subscription) => {
            let pending = loading.get(subscription.id);
            if (!pending) {
              pending = load(subscription).finally(() => loading.delete(subscription.id));
              loading.set(subscription.id, pending);
            }
            return pending;
          }),
      );
    },

    /** Drops a feed and its cached copy, when it is removed or its address changes. */
    async forget(id: string) {
      states.delete(id);
      await store.set(`feed:${id}`, null).catch(() => undefined);
    },

    /** The entries of the shown subscriptions that overlap [from, to) (instants). */
    entries(
      list: readonly Subscription[],
      shown: (subscription: Subscription) => boolean,
      from: number,
      to: number,
      cancelled: "show" | "hide",
    ): Entry[] {
      return list
        .filter((subscription) => subscription.enabled && shown(subscription))
        .flatMap((subscription) =>
          subscriptionEntries(
            subscription,
            occurrencesBetween(states.get(subscription.id)?.events ?? [], from, to, { cancelled }),
          ),
        );
    },
  };
};

export type SubscriptionFeeds = ReturnType<typeof createSubscriptionFeeds>;

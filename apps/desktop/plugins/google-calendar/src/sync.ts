import { GoogleApiError, type GoogleApi } from "./googleApi";
import { instantOf, type GEvent } from "./googleEvents";

/*
 * Keeps each calendar's events for a span of time in step with Google. The first sync lists
 * the span's events, with recurring events expanded; after that, the sync token from the last
 * page brings only what changed. Google answers 410 Gone when a token is too old, and the
 * calendar is then listed again from scratch
 * (https://developers.google.com/workspace/calendar/api/guides/sync).
 */

/** What is kept per calendar between syncs and sessions. */
export type CalendarSync = {
  /** The span the events cover, as RFC 3339 instants. */
  from: string;
  to: string;
  syncToken: string | null;
  events: Record<string, GEvent>;
};

/** The span listed for a wanted range: some weeks either side, so moving a little needs no full sync. */
export const syncSpan = (from: number, to: number) => ({
  from: new Date(from - 28 * 86_400_000).toISOString(),
  to: new Date(to + 56 * 86_400_000).toISOString(),
});

const MAX_PAGES = 40;

const overlaps = (event: GEvent, from: string, to: string) => {
  const start = instantOf(event.start);
  const end = instantOf(event.end);
  return start < Date.parse(to) && (Number.isFinite(end) ? end : start) > Date.parse(from);
};

export const createSyncEngine = ({
  api,
  load,
  save,
}: {
  api: Pick<GoogleApi, "listEvents">;
  /** A calendar's saved state, or null. */
  load: (calendarId: string) => Promise<CalendarSync | null>;
  save: (calendarId: string, state: CalendarSync | null) => Promise<void>;
}) => {
  const states = new Map<string, CalendarSync>();
  const running = new Map<string, Promise<CalendarSync>>();

  const full = async (calendarId: string, from: string, to: string): Promise<CalendarSync> => {
    const events: Record<string, GEvent> = {};
    let pageToken: string | undefined;
    let syncToken: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await api.listEvents(calendarId, { timeMin: from, timeMax: to, pageToken });
      for (const event of result.items ?? [])
        if (event.status !== "cancelled") events[event.id] = event;
      pageToken = result.nextPageToken;
      syncToken = result.nextSyncToken ?? syncToken;
      if (!pageToken) break;
    }
    return { from, to, syncToken, events };
  };

  const incremental = async (calendarId: string, state: CalendarSync): Promise<CalendarSync> => {
    const events = { ...state.events };
    let pageToken: string | undefined;
    let syncToken = state.syncToken;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await api.listEvents(calendarId, {
        syncToken: state.syncToken!,
        pageToken,
      });
      for (const event of result.items ?? []) {
        // A change lists every instance it touched, also outside the span; only the span is kept.
        if (event.status === "cancelled" || !overlaps(event, state.from, state.to))
          delete events[event.id];
        else events[event.id] = event;
      }
      pageToken = result.nextPageToken;
      syncToken = result.nextSyncToken ?? syncToken;
      if (!pageToken) break;
    }
    return { ...state, syncToken, events };
  };

  const run = async (calendarId: string, from: number, to: number) => {
    let state = states.get(calendarId) ?? (await load(calendarId));
    const covers = state?.syncToken && Date.parse(state.from) <= from && Date.parse(state.to) >= to;
    if (state && covers) {
      try {
        state = await incremental(calendarId, state);
      } catch (error) {
        if (!(error instanceof GoogleApiError) || error.status !== 410) throw error;
        // The token is no longer good: forget everything and list the calendar again.
        states.delete(calendarId);
        await save(calendarId, null);
        state = null;
      }
    } else state = null;
    if (!state) {
      const span = syncSpan(from, to);
      state = await full(calendarId, span.from, span.to);
    }
    states.set(calendarId, state);
    await save(calendarId, state);
    return state;
  };

  return {
    /**
     * Brings a calendar up to date for `from`–`to` (instants), one sync per calendar at a time;
     * a call while one runs waits for it and then syncs again.
     */
    async sync(calendarId: string, from: number, to: number): Promise<CalendarSync> {
      const before = running.get(calendarId);
      if (before) await before.catch(() => undefined);
      const next = run(calendarId, from, to).finally(() => {
        if (running.get(calendarId) === next) running.delete(calendarId);
      });
      running.set(calendarId, next);
      return next;
    },

    /** The events kept for a calendar now, without asking Google. */
    events(calendarId: string): GEvent[] {
      return Object.values(states.get(calendarId)?.events ?? {});
    },

    /** Reads what was saved for a calendar in an earlier session, to show before the first sync. */
    async restore(calendarId: string) {
      if (states.has(calendarId)) return;
      const saved = await load(calendarId);
      if (saved) states.set(calendarId, saved);
    },

    /** Puts an event in (or, with null, takes it out of) a calendar's kept events, as a write does. */
    put(calendarId: string, eventId: string, event: GEvent | null) {
      const state = states.get(calendarId);
      if (!state) return;
      const events = { ...state.events };
      if (event && event.status !== "cancelled") events[eventId] = event;
      else delete events[eventId];
      states.set(calendarId, { ...state, events });
    },

    get(calendarId: string, eventId: string): GEvent | null {
      return states.get(calendarId)?.events[eventId] ?? null;
    },

    /** Forgets every calendar, as signing out does. */
    clear() {
      states.clear();
    },
  };
};

export type SyncEngine = ReturnType<typeof createSyncEngine>;

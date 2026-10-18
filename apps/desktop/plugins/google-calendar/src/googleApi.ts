import type { FetchResponse, GoogleCalendarRequest } from "@loam/plugin-api";

import type { GCalendar, GEvent } from "./googleEvents";

/*
 * The Google Calendar API calls the plugin makes, through `$.google.calendar` (the main
 * process adds the token). Rate limits and server errors are tried again with exponential
 * backoff and jitter, as Google asks
 * (https://developers.google.com/workspace/calendar/api/guides/errors).
 */

/** A failed Calendar API call: Google's status, its reason (such as `rateLimitExceeded`) and words. */
export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export type Send = (request: GoogleCalendarRequest) => Promise<FetchResponse>;

const RETRY_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);
const MAX_PAGES = 40;

const errorOf = (response: FetchResponse) => {
  try {
    const { error } = JSON.parse(response.body) as {
      error?: { message?: string; errors?: { reason?: string }[]; status?: string };
    };
    return {
      reason: error?.errors?.[0]?.reason ?? error?.status ?? "",
      message: error?.message ?? `Google Calendar answered ${response.status}.`,
    };
  } catch {
    return { reason: "", message: `Google Calendar answered ${response.status}.` };
  }
};

/** Whether a failure is worth trying again after a pause. */
export const isRetryable = (status: number, reason: string) =>
  status === 429 || status >= 500 || (status === 403 && RETRY_REASONS.has(reason));

/**
 * How long to wait before try `attempt` (0 for the first retry): doubling from a second, up
 * to 32 seconds, plus up to a second of jitter so many clients don't retry together. A
 * Retry-After header wins.
 */
export const backoffDelay = (attempt: number, random: number, retryAfter?: string) => {
  const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 60) * 1000;
  return Math.min(32_000, 1000 * 2 ** attempt) + Math.floor(random * 1000);
};

const encode = (id: string) => encodeURIComponent(id);

type WriteOptions = {
  sendUpdates?: "all" | "externalOnly" | "none";
  /** 1 to add a Google Meet link (conferenceData.createRequest). */
  conferenceDataVersion?: 0 | 1;
  /** The version the change was made to; Google answers 412 if the event changed since. */
  etag?: string;
};

export type ListPage = {
  items?: GEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

export const createGoogleApi = ({
  send,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  random = Math.random,
  maxRetries = 5,
}: {
  send: Send;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  maxRetries?: number;
}) => {
  const call = async <T>(request: GoogleCalendarRequest): Promise<T> => {
    for (let attempt = 0; ; attempt += 1) {
      const response = await send(request);
      if (response.status >= 200 && response.status < 300)
        return (response.body ? JSON.parse(response.body) : null) as T;
      const { reason, message } = errorOf(response);
      if (attempt < maxRetries && isRetryable(response.status, reason)) {
        await sleep(backoffDelay(attempt, random(), response.headers["retry-after"]));
        continue;
      }
      throw new GoogleApiError(response.status, reason, message);
    }
  };

  const writeQuery = (options: WriteOptions) => ({
    ...(options.sendUpdates && { sendUpdates: options.sendUpdates }),
    ...(options.conferenceDataVersion !== undefined && {
      conferenceDataVersion: options.conferenceDataVersion,
    }),
  });
  const ifMatch = (etag?: string) => (etag ? { headers: { "If-Match": etag } } : {});

  return {
    call,

    /** Every calendar in the user's list, following pages. */
    async calendars(): Promise<GCalendar[]> {
      const calendars: GCalendar[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await call<{ items?: GCalendar[]; nextPageToken?: string }>({
          path: "/users/me/calendarList",
          query: { maxResults: 250, ...(pageToken && { pageToken }) },
        });
        calendars.push(...(result.items ?? []));
        pageToken = result.nextPageToken;
        if (!pageToken) break;
      }
      return calendars.filter((calendar) => !calendar.deleted);
    },

    /** One page of a calendar's events, each recurring event expanded into its instances. */
    listEvents(
      calendarId: string,
      query: { timeMin?: string; timeMax?: string; syncToken?: string; pageToken?: string },
    ) {
      return call<ListPage>({
        path: `/calendars/${encode(calendarId)}/events`,
        query: {
          singleEvents: true,
          maxResults: 2500,
          ...(query.syncToken
            ? { syncToken: query.syncToken }
            : {
                ...(query.timeMin && { timeMin: query.timeMin }),
                ...(query.timeMax && { timeMax: query.timeMax }),
              }),
          ...(query.pageToken && { pageToken: query.pageToken }),
        },
      });
    },

    /** A recurring event's exceptions: every changed instance shares the series' iCalUID. */
    async exceptions(calendarId: string, master: GEvent): Promise<GEvent[]> {
      if (!master.iCalUID) return [];
      const result = await call<{ items?: GEvent[] }>({
        path: `/calendars/${encode(calendarId)}/events`,
        query: {
          iCalUID: master.iCalUID,
          singleEvents: false,
          showDeleted: false,
          maxResults: 2500,
        },
      });
      return (result.items ?? []).filter((event) => event.recurringEventId === master.id);
    },

    get(calendarId: string, eventId: string) {
      return call<GEvent>({ path: `/calendars/${encode(calendarId)}/events/${encode(eventId)}` });
    },

    insert(calendarId: string, event: Partial<GEvent>, options: WriteOptions = {}) {
      return call<GEvent>({
        method: "POST",
        path: `/calendars/${encode(calendarId)}/events`,
        query: writeQuery(options),
        body: JSON.stringify(event),
      });
    },

    patch(
      calendarId: string,
      eventId: string,
      patch: Partial<GEvent> | Record<string, unknown>,
      options: WriteOptions = {},
    ) {
      return call<GEvent>({
        method: "PATCH",
        path: `/calendars/${encode(calendarId)}/events/${encode(eventId)}`,
        query: writeQuery(options),
        body: JSON.stringify(patch),
        ...ifMatch(options.etag),
      });
    },

    async remove(calendarId: string, eventId: string, options: WriteOptions = {}) {
      await call<null>({
        method: "DELETE",
        path: `/calendars/${encode(calendarId)}/events/${encode(eventId)}`,
        query: writeQuery(options),
        ...ifMatch(options.etag),
      });
    },
  };
};

export type GoogleApi = ReturnType<typeof createGoogleApi>;

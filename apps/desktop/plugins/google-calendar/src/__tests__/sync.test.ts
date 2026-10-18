import { describe, expect, it } from "vitest";

import { backoffDelay, createGoogleApi, GoogleApiError } from "../googleApi";
import { createSyncEngine, type CalendarSync } from "../sync";
import { createFakeGoogleCalendar, sendTo } from "../testing/fakeGoogleCalendar";

const CAL = "me@example.com";
const at = (iso: string) => ({ dateTime: iso, timeZone: "UTC" });
const FROM = Date.parse("2026-10-12T00:00:00Z");
const TO = Date.parse("2026-10-19T00:00:00Z");

const setup = (options: { pageSize?: number } = {}) => {
  const fake = createFakeGoogleCalendar(options);
  const sleeps: number[] = [];
  const api = createGoogleApi({
    send: sendTo(fake),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
  });
  const saved = new Map<string, CalendarSync | null>();
  const engine = createSyncEngine({
    api,
    load: async (id) => saved.get(id) ?? null,
    save: async (id, state) => {
      saved.set(id, state);
    },
  });
  const titles = () =>
    engine
      .events(CAL)
      .map((event) => event.summary)
      .sort();
  return { fake, api, engine, saved, sleeps, titles };
};

describe("the sync engine", () => {
  it("lists the span first, then asks only for changes with the sync token", async () => {
    const { fake, engine, titles, saved } = setup();
    fake.add(CAL, {
      summary: "Standup",
      start: at("2026-10-13T09:00:00Z"),
      end: at("2026-10-13T09:15:00Z"),
    });
    await engine.sync(CAL, FROM, TO);
    expect(titles()).toEqual(["Standup"]);
    expect(saved.get(CAL)?.syncToken).toMatch(/^sync-/);

    fake.add(CAL, {
      summary: "Lunch",
      start: at("2026-10-14T12:00:00Z"),
      end: at("2026-10-14T13:00:00Z"),
    });
    fake.requests.length = 0;
    await engine.sync(CAL, FROM, TO);
    expect(titles()).toEqual(["Lunch", "Standup"]);
    expect(fake.requests[0]!.query.syncToken).toBeDefined();
    expect(fake.requests[0]!.query.timeMin).toBeUndefined();
  });

  it("drops what was deleted in Google, and a whole series with it", async () => {
    const { fake, api, engine, titles } = setup();
    const lunch = fake.add(CAL, {
      summary: "Lunch",
      start: at("2026-10-14T12:00:00Z"),
      end: at("2026-10-14T13:00:00Z"),
    });
    const series = fake.add(CAL, {
      summary: "Gym",
      start: at("2026-10-12T07:00:00Z"),
      end: at("2026-10-12T08:00:00Z"),
      recurrence: ["RRULE:FREQ=DAILY;COUNT=5"],
    });
    await engine.sync(CAL, FROM, TO);
    expect(titles()).toEqual(["Gym", "Gym", "Gym", "Gym", "Gym", "Lunch"]);
    await api.remove(CAL, lunch.id);
    await api.remove(CAL, series.id);
    await engine.sync(CAL, FROM, TO);
    expect(titles()).toEqual([]);
  });

  it("lists everything again when Google says the token is too old", async () => {
    const { fake, engine, titles, saved } = setup();
    fake.add(CAL, {
      summary: "Standup",
      start: at("2026-10-13T09:00:00Z"),
      end: at("2026-10-13T09:15:00Z"),
    });
    await engine.sync(CAL, FROM, TO);
    fake.expireSyncTokens();
    fake.add(CAL, {
      summary: "Review",
      start: at("2026-10-15T15:00:00Z"),
      end: at("2026-10-15T16:00:00Z"),
    });
    fake.requests.length = 0;
    await engine.sync(CAL, FROM, TO);
    expect(fake.requests.map((request) => (request.query.syncToken ? "token" : "full"))).toEqual([
      "token",
      "full",
    ]);
    expect(titles()).toEqual(["Review", "Standup"]);
    expect(saved.get(CAL)?.syncToken).toMatch(/^sync-/);
  });

  it("follows pages, and keeps the sync token that comes with the last", async () => {
    const { fake, engine, saved } = setup({ pageSize: 2 });
    for (let day = 12; day < 17; day += 1)
      fake.add(CAL, {
        summary: `Day ${day}`,
        start: at(`2026-10-${day}T10:00:00Z`),
        end: at(`2026-10-${day}T11:00:00Z`),
      });
    await engine.sync(CAL, FROM, TO);
    expect(engine.events(CAL)).toHaveLength(5);
    expect(fake.requests.filter((request) => request.method === "GET")).toHaveLength(3);
    expect(saved.get(CAL)?.syncToken).toMatch(/^sync-/);
  });

  it("lists again for a range outside the span it has", async () => {
    const { fake, engine } = setup();
    await engine.sync(CAL, FROM, TO);
    fake.requests.length = 0;
    await engine.sync(CAL, FROM + 200 * 86_400_000, TO + 200 * 86_400_000);
    expect(fake.requests[0]!.query.timeMin).toBeDefined();
  });

  it("shows what an earlier session saved before asking Google", async () => {
    const first = setup();
    first.fake.add(CAL, {
      summary: "Standup",
      start: at("2026-10-13T09:00:00Z"),
      end: at("2026-10-13T09:15:00Z"),
    });
    await first.engine.sync(CAL, FROM, TO);
    const again = createSyncEngine({
      api: { listEvents: () => Promise.reject(new Error("offline")) },
      load: async (id) => first.saved.get(id) ?? null,
      save: async () => undefined,
    });
    await again.restore(CAL);
    expect(again.events(CAL).map((event) => event.summary)).toEqual(["Standup"]);
  });
});

describe("the Calendar API client", () => {
  it("tries again after rate limits and server errors, waiting longer each time", async () => {
    const { fake, api, sleeps } = setup();
    fake.failNext(403, "rateLimitExceeded");
    fake.failNext(429, "rateLimitExceeded");
    fake.failNext(503, "backendError");
    const calendars = await api.calendars();
    expect(calendars.map((calendar) => calendar.id)).toEqual([CAL]);
    expect(sleeps).toEqual([1500, 2500, 4500]);
  });

  it("gives up after five retries, and doesn't retry what can't succeed", async () => {
    const { fake, api, sleeps } = setup();
    for (let index = 0; index < 6; index += 1) fake.failNext(500);
    await expect(api.calendars()).rejects.toMatchObject({ status: 500 });
    expect(sleeps).toHaveLength(5);

    fake.failNext(403, "forbidden");
    await expect(api.calendars()).rejects.toMatchObject({ status: 403, reason: "forbidden" });
    expect(sleeps).toHaveLength(5);
  });

  it("lets Retry-After decide the wait, and adds jitter otherwise", () => {
    expect(backoffDelay(0, 0, "7")).toBe(7000);
    expect(backoffDelay(3, 0.25)).toBe(8250);
    expect(backoffDelay(10, 0)).toBe(32_000);
  });

  it("refuses a change to an event that changed since, with 412", async () => {
    const { fake, api } = setup();
    const event = fake.add(CAL, {
      summary: "Lunch",
      start: at("2026-10-14T12:00:00Z"),
      end: at("2026-10-14T13:00:00Z"),
    });
    const renamed = await api.patch(CAL, event.id, { summary: "Long lunch" }, { etag: event.etag });
    expect(renamed.summary).toBe("Long lunch");
    const stale = api.patch(CAL, event.id, { summary: "Brunch" }, { etag: event.etag });
    await expect(stale).rejects.toBeInstanceOf(GoogleApiError);
    await expect(stale).rejects.toMatchObject({ status: 412 });
    // Without the ETag the change overwrites.
    await expect(api.patch(CAL, event.id, { summary: "Brunch" })).resolves.toMatchObject({
      summary: "Brunch",
    });
  });
});

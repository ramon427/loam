import { describe, expect, it } from "vitest";

import { googleTime, gridEvent, entriesIn, type Entry } from "../model";
import { createSubscriptionFeeds, type FeedFetch } from "../subscriptionFeeds";
import { addSubscription, type Subscription } from "../subscriptions";
import { OUTLOOK_CALENDAR } from "../testing/outlookCalendar";

const WORK =
  "https://outlook.office365.com/owa/calendar/0f1e2d3c4b5a@contoso.example/a1b2c3d4e5f6/calendar.ics";
const FAMILY = "https://calendar.google.com/calendar/ical/family%40gmail.com/private-1/basic.ics";

const familyFeed = [
  "BEGIN:VCALENDAR",
  "X-WR-CALNAME:Family",
  "BEGIN:VEVENT",
  "UID:dinner",
  "DTSTART;TZID=Europe/Berlin:20261020T183000",
  "DTEND;TZID=Europe/Berlin:20261020T200000",
  "SUMMARY:Dinner with Sam",
  "DESCRIPTION:Video: https://meet.google.com/abc-defg-hij",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

type Answer = { status: number; body?: string; headers?: Record<string, string> } | Error;

/** A fake network answering each address in turn, and a store kept in a map. */
const setup = (answers: Record<string, Answer | Answer[]>) => {
  const asked: string[] = [];
  const fetch: FeedFetch = async (url) => {
    asked.push(url);
    const answer = answers[url];
    const next = Array.isArray(answer)
      ? answer.length > 1
        ? answer.shift()!
        : answer[0]!
      : answer;
    if (!next) throw new Error("fetch failed");
    if (next instanceof Error) throw next;
    return { status: next.status, headers: next.headers ?? {}, body: next.body ?? "" };
  };
  const saved = new Map<string, unknown>();
  const store = {
    get: async <T>(key: string) => (saved.get(key) as T) ?? null,
    set: async (key: string, value: unknown) => {
      if (value === null) saved.delete(key);
      else saved.set(key, value);
      return null;
    },
  };
  let clock = Date.parse("2026-10-18T12:00:00Z");
  const now = () => clock;
  const advance = (ms: number) => (clock += ms);
  return { fetch, store, saved, asked, now, advance };
};

const list = (): Subscription[] =>
  addSubscription(addSubscription([], WORK, "Work calendar"), FAMILY, "Family");

const week = { from: Date.parse("2026-10-19T00:00:00Z"), to: Date.parse("2026-10-24T00:00:00Z") };

describe("subscription feeds", () => {
  it("reads every subscription, merges them with Google's events, and keeps them read-only", async () => {
    const net = setup({
      [WORK]: { status: 200, body: OUTLOOK_CALENDAR },
      [FAMILY]: { status: 200, body: familyFeed },
    });
    const feeds = createSubscriptionFeeds(net);
    const subscriptions = list();
    await feeds.refresh(subscriptions, { maxAge: 0 });
    expect(feeds.state("s1")).toMatchObject({ name: "Calendar", error: null });
    expect(feeds.state("s2")).toMatchObject({ name: "Family", error: null });

    const google: Entry = {
      key: "c0/standup",
      calendarId: "primary",
      calendar: { id: "primary", accessRole: "owner", backgroundColor: "#9fe1e7" },
      event: {
        id: "g1",
        summary: "Dentist",
        start: googleTime("2026-10-20T10:15:00Z", false, "UTC"),
        end: googleTime("2026-10-20T11:00:00Z", false, "UTC"),
      },
    };
    const merged = entriesIn(
      [google, ...feeds.entries(subscriptions, () => true, week.from, week.to, "show")],
      Math.floor(week.from / 86_400_000) - 1,
      Math.floor(week.to / 86_400_000) + 1,
    );
    const titles = merged.map((entry) => entry.event.summary);
    expect(titles).toContain("Dentist");
    expect(titles).toContain("Customer workshop");
    expect(titles).toContain("Dinner with Sam");

    const dentist = gridEvent(merged.find((entry) => entry.event.summary === "Dentist")!);
    expect(dentist.readOnly).toBeUndefined();
    const workshop = merged.find((entry) => entry.event.summary === "Customer workshop")!;
    expect(gridEvent(workshop)).toMatchObject({ readOnly: true, color: "#f4511e" });
    expect(workshop.calendar).toMatchObject({ summary: "Work calendar" });

    // Private time shows as busy, cancelled meetings struck through, tentative ones striped.
    const busy = merged.find((entry) => entry.extra?.private)!;
    expect(busy.event.summary).toBe("Busy");
    const vendor = merged.find((entry) => entry.event.summary === "Vendor demo")!;
    expect(gridEvent(vendor)).toMatchObject({ cancelled: true });
    const budget = merged.find((entry) => entry.event.summary === "Budget check-in")!;
    expect(gridEvent(budget)).toMatchObject({ tentative: true });
    const dinner = merged.find((entry) => entry.event.summary === "Dinner with Sam")!;
    expect(dinner.extra?.joinUrl).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("leaves out hidden and switched-off calendars, and cancelled meetings when asked", async () => {
    const net = setup({
      [WORK]: { status: 200, body: OUTLOOK_CALENDAR },
      [FAMILY]: { status: 200, body: familyFeed },
    });
    const feeds = createSubscriptionFeeds(net);
    const [work, family] = list();
    await feeds.refresh([work!, family!], { maxAge: 0 });
    const shownTitles = (
      subscriptions: Subscription[],
      shown: (subscription: Subscription) => boolean = () => true,
      cancelled: "show" | "hide" = "show",
    ) =>
      feeds
        .entries(subscriptions, shown, week.from, week.to, cancelled)
        .map((entry) => entry.event.summary);
    expect(shownTitles([work!, family!], () => true)).toContain("Dinner with Sam");
    expect(shownTitles([work!, family!], (item) => item.id !== "s2")).not.toContain(
      "Dinner with Sam",
    );
    expect(shownTitles([work!, { ...family!, enabled: false }])).not.toContain("Dinner with Sam");
    expect(shownTitles([work!], () => true, "hide")).not.toContain("Vendor demo");
  });

  it("says why a feed failed without holding up the others", async () => {
    const net = setup({
      [WORK]: { status: 403, body: "Forbidden" },
      [FAMILY]: { status: 200, body: familyFeed },
    });
    const feeds = createSubscriptionFeeds(net);
    await feeds.refresh(list(), { maxAge: 0 });
    expect(feeds.state("s1")!.error).toBe(
      "Couldn't load Work calendar. The link may be disabled by your organisation, or the calendar is no longer published.",
    );
    expect(feeds.state("s2")!.error).toBeNull();
    expect(feeds.entries(list(), () => true, week.from, week.to, "show")).toHaveLength(1);
  });

  it("keeps the last good copy when a feed fails later, and says how old it is", async () => {
    const net = setup({
      [WORK]: [{ status: 200, body: OUTLOOK_CALENDAR }, new Error("fetch failed")],
    });
    const feeds = createSubscriptionFeeds(net);
    const [work] = list();
    await feeds.refresh([work!], { maxAge: 0 });
    const count = feeds.entries([work!], () => true, week.from, week.to, "show").length;
    net.advance(20 * 60_000);
    await feeds.refresh([work!], { maxAge: 15 * 60_000 });
    expect(feeds.state("s1")!.error).toMatch(
      /^Couldn't reach Work calendar\. Check your connection\. Showing the copy from /,
    );
    expect(feeds.entries([work!], () => true, week.from, week.to, "show")).toHaveLength(count);
  });

  it("starts from the cached copy, and asks again only when a feed is due", async () => {
    const net = setup({ [WORK]: { status: 200, body: OUTLOOK_CALENDAR } });
    const first = createSubscriptionFeeds(net);
    const [work] = list();
    await first.refresh([work!], { maxAge: 0 });
    expect(net.saved.has("feed:s1")).toBe(true);

    // The next start, offline: the cache alone, zones and all.
    const offline = setup({ [WORK]: new Error("offline") });
    offline.saved.set("feed:s1", JSON.parse(JSON.stringify(net.saved.get("feed:s1"))));
    const second = createSubscriptionFeeds(offline);
    await second.restore([work!]);
    const titles = second
      .entries([work!], () => true, week.from, week.to, "show")
      .map((entry) => [entry.event.summary, entry.event.start?.dateTime]);
    expect(titles).toContainEqual(["Call with London office", "2026-10-22T09:00:00.000Z"]);

    await first.refresh([work!], { maxAge: 15 * 60_000 });
    expect(net.asked).toHaveLength(1);
    net.advance(16 * 60_000);
    await first.refresh([work!], { maxAge: 15 * 60_000 });
    expect(net.asked).toHaveLength(2);
  });

  it("follows redirects to hosts it may reach, and refuses others", async () => {
    const moved = "https://outlook.office.com/owa/calendar/x/calendar.ics";
    const net = setup({
      [WORK]: { status: 302, headers: { Location: moved } },
      [moved]: { status: 200, body: OUTLOOK_CALENDAR },
      [FAMILY]: { status: 301, headers: { location: "https://evil.example/x.ics" } },
    });
    const feeds = createSubscriptionFeeds(net);
    await feeds.refresh(list(), { maxAge: 0 });
    expect(feeds.state("s1")!.error).toBeNull();
    expect(feeds.state("s2")!.error).toMatch(/moves to evil\.example, which Loam can't read/);
  });

  it("explains a page that isn't a calendar, and a host the plugin wasn't granted", async () => {
    const net = setup({
      [WORK]: { status: 200, body: "<!doctype html><title>Outlook</title>" },
      [FAMILY]: new Error("The plugin was not granted that address."),
    });
    const feeds = createSubscriptionFeeds(net);
    await feeds.refresh(list(), { maxAge: 0 });
    expect(feeds.state("s1")!.error).toMatch(/Copy the ICS link, not the HTML one/);
    expect(feeds.state("s2")!.error).toMatch(/Review its permissions in Settings, Plugins/);
  });
});

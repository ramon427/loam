import { describe, expect, it } from "vitest";

import { parseIcs, type IcsEvent } from "../ics";
import { occurrencesBetween } from "../recurrence";
import { OUTLOOK_CALENDAR } from "../testing/outlookCalendar";

const calendar = parseIcs(OUTLOOK_CALENDAR);

const between = (from: string, to: string, cancelled: "show" | "hide" = "hide") =>
  occurrencesBetween(calendar.events, Date.parse(from), Date.parse(to), { cancelled });

const named = (summary: string) => calendar.events.find((event) => event.summary === summary)!;
const startsOf = (items: { event: IcsEvent; start: number }[], summary: string) =>
  items
    .filter((item) => item.event.summary.startsWith(summary))
    .map((item) => new Date(item.start).toISOString());

describe("an Outlook published calendar", () => {
  it("reads every event, unfolding Outlook's long lines", () => {
    expect(calendar.name).toBe("Calendar");
    expect(calendar.events).toHaveLength(15);
    const standup = named("Daily standup");
    expect(standup.description).toContain("Microsoft Teams meeting\nJoin on your computer");
    expect(standup.organizer).toBe("Alex Morgan");
    expect(named("Design review").location).toBe("Room 3.14; Microsoft Teams Meeting");
  });

  it("places a recurring Teams meeting's skipped, moved and cancelled occurrences", () => {
    const week = between("2026-10-19T00:00:00Z", "2026-10-27T00:00:00Z");
    expect(startsOf(week, "Daily standup")).toEqual([
      "2026-10-19T07:30:00.000Z",
      "2026-10-20T07:30:00.000Z",
      // Wednesday is an EXDATE; Thursday moved to 11:00; Friday was cancelled.
      "2026-10-22T09:00:00.000Z",
      // After Europe's clocks go back on October 25, 9:30 is 8:30 UTC.
      "2026-10-26T08:30:00.000Z",
    ]);
    expect(week.find((item) => item.event.summary === "Daily standup (moved)")).toBeDefined();
  });

  it("shows cancelled meetings, without Outlook's title prefix, when asked", () => {
    const week = between("2026-10-19T00:00:00Z", "2026-10-24T00:00:00Z", "show");
    const cancelled = week.filter((item) => item.event.cancelled);
    expect(
      cancelled.map((item) => [item.event.summary, new Date(item.start).toISOString()]),
    ).toEqual([
      ["Vendor demo", "2026-10-22T13:00:00.000Z"],
      ["Daily standup", "2026-10-23T07:30:00.000Z"],
    ]);
    expect(
      between("2026-10-22T00:00:00Z", "2026-10-24T00:00:00Z").some((i) => i.event.cancelled),
    ).toBe(false);
  });

  it("reads Pacific and customized zones across their own daylight saving changes", () => {
    const span = between("2026-10-19T00:00:00Z", "2026-11-06T00:00:00Z");
    // The US changes on November 1, a week after Europe.
    expect(startsOf(span, "Sync with Seattle")).toEqual([
      "2026-10-21T15:00:00.000Z",
      "2026-10-28T15:00:00.000Z",
      "2026-11-04T16:00:00.000Z",
    ]);
    // "Customized Time Zone" carries London's rules in its VTIMEZONE.
    expect(startsOf(span, "Call with London office")).toEqual([
      "2026-10-22T09:00:00.000Z",
      "2026-10-29T10:00:00.000Z",
      "2026-11-05T10:00:00.000Z",
    ]);
  });

  it("reads all-day events, including midnight times Outlook flags as all day", () => {
    expect(named("Company offsite")).toMatchObject({
      start: { kind: "date", y: 2026, m: 10, d: 29 },
      end: { kind: "date", y: 2026, m: 10, d: 31 },
      busyStatus: "OOF",
    });
    expect(named("Team day off")).toMatchObject({
      start: { kind: "date", y: 2026, m: 11, d: 3 },
      end: { kind: "date", y: 2026, m: 11, d: 4 },
    });
  });

  it("keeps private, tentative and free time apart", () => {
    const privateEvent = calendar.events.find((event) => event.private)!;
    expect(privateEvent).toMatchObject({ summary: "", busyStatus: "BUSY" });
    expect(named("Budget check-in").busyStatus).toBe("TENTATIVE");
    expect(named("Focus time")).toMatchObject({ transparent: true, busyStatus: "FREE" });
  });

  it("finds each meeting's join link wherever Outlook put it", () => {
    expect(named("Daily standup").joinUrl).toMatch(
      /^https:\/\/teams\.microsoft\.com\/l\/meetup-join\/19%3ameeting_ZmFrZS1zdGFuZHVw/,
    );
    expect(named("Design review").joinUrl).toMatch(/meeting_ZGVzaWduLXJldmlldy0wMDI/);
    expect(named("Sync with Seattle").joinUrl).toBe(
      "https://teams.microsoft.com/meet/27612345678901?p=QwErTy12AsDf",
    );
    expect(named("Architecture sync").joinUrl).toBe(
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_YXJjaC1zeW5jLTAwMw%40thread.v2/0",
    );
    expect(named("Partner intro").joinUrl).toMatch(/^https:\/\/contoso\.zoom\.us\/j\//);
    expect(named("Customer workshop").joinUrl).toBe("");
  });

  it("prefers the plain description to the HTML one", () => {
    expect(named("Design review").description).toMatch(/^Bring the latest mock-ups\./);
    const htmlOnly = parseIcs(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:h",
        "DTSTART:20261020T100000Z",
        'X-ALT-DESC;FMTTYPE=text/html:<p>Hello <b>there</b></p><p><a href="https://example.com/x">Agenda</a></p>',
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    ).events[0]!;
    expect(htmlOnly.description).toBe("Hello there\nAgenda (https://example.com/x)");
  });
});

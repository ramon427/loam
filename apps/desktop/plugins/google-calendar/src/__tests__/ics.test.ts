import { describe, expect, it } from "vitest";

import { toInstant } from "../dates";
import { parseDuration, parseIcs, parseIcsDate, parseRRule, unfoldLines } from "../ics";

const feed = (...lines: string[]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
    "X-WR-CALNAME:Work",
    ...lines,
    "END:VCALENDAR",
  ].join("\r\n");

describe("parseIcs", () => {
  it("reads events and the calendar's name, unfolding long lines and unescaping text", () => {
    const calendar = parseIcs(
      feed(
        "BEGIN:VEVENT",
        "UID:abc@google.com",
        "DTSTART:20261020T080000Z",
        "DTEND:20261020T083000Z",
        "SUMMARY:Planning\\, part 1\\; draft",
        "DESCRIPTION:First line\\nSecond line with a very long text that Google folds o",
        " nto the next line\\\\done",
        "LOCATION:Room 4",
        "URL:https://example.com/meet",
        "END:VEVENT",
      ),
    );

    expect(calendar.name).toBe("Work");
    expect(calendar.events).toHaveLength(1);
    expect(calendar.events[0]).toMatchObject({
      uid: "abc@google.com",
      summary: "Planning, part 1; draft",
      description:
        "First line\nSecond line with a very long text that Google folds onto the next line\\done",
      location: "Room 4",
      url: "https://example.com/meet",
      start: { kind: "time", y: 2026, m: 10, d: 20, h: 8, mi: 0, zone: "utc" },
    });
  });

  it("reads all-day dates, named zones and quoted parameters", () => {
    const [allDay, zoned] = parseIcs(
      feed(
        "BEGIN:VEVENT",
        "UID:1",
        "DTSTART;VALUE=DATE:20261224",
        "DTEND;VALUE=DATE:20261226",
        "SUMMARY:Holidays",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:2",
        'DTSTART;TZID="America/New_York":20260701T090000',
        "DURATION:PT1H30M",
        'ATTENDEE;CN="Doe: Jane":mailto:jane@example.com',
        "SUMMARY:Standup",
        "END:VEVENT",
      ),
    ).events;

    expect(allDay!.start).toEqual({ kind: "date", y: 2026, m: 12, d: 24 });
    expect(allDay!.end).toEqual({ kind: "date", y: 2026, m: 12, d: 26 });
    expect(zoned!.start).toMatchObject({ kind: "time", h: 9, zone: "America/New_York" });
    expect(zoned!.duration).toBe(5400);
    expect(new Date(toInstant(zoned!.start)).toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });

  it("skips time zone blocks, alarms and events without a start", () => {
    const calendar = parseIcs(
      feed(
        "BEGIN:VTIMEZONE",
        "TZID:Europe/Berlin",
        "BEGIN:DAYLIGHT",
        "DTSTART:19700329T020000",
        "END:DAYLIGHT",
        "END:VTIMEZONE",
        "BEGIN:VEVENT",
        "UID:no-start",
        "SUMMARY:Broken",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:ok",
        "DTSTART;TZID=Europe/Berlin:20260105T100000",
        "SUMMARY:Kept",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:This is an alarm",
        "END:VALARM",
        "END:VEVENT",
      ),
    );
    expect(calendar.events.map((event) => [event.summary, event.description])).toEqual([
      ["Kept", ""],
    ]);
    expect(new Date(toInstant(calendar.events[0]!.start)).toISOString()).toBe(
      "2026-01-05T09:00:00.000Z",
    );
  });

  it("collects EXDATE lists and reads RECURRENCE-ID and STATUS", () => {
    const [series, moved] = parseIcs(
      feed(
        "BEGIN:VEVENT",
        "UID:s",
        "DTSTART:20261001T090000Z",
        "RRULE:FREQ=DAILY;COUNT=5",
        "EXDATE:20261002T090000Z,20261003T090000Z",
        "EXDATE:20261004T090000Z",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:s",
        "RECURRENCE-ID:20261005T090000Z",
        "DTSTART:20261005T150000Z",
        "STATUS:CONFIRMED",
        "END:VEVENT",
      ),
    ).events;
    expect(series!.exdates).toHaveLength(3);
    expect(series!.rrule).toMatchObject({ freq: "DAILY", count: 5 });
    expect(moved!.recurrenceId).toMatchObject({ d: 5, h: 9, zone: "utc" });
    expect(moved!.status).toBe("CONFIRMED");
  });
});

describe("value readers", () => {
  it("unfolds lines with a space or a tab after the break", () => {
    expect(unfoldLines("A:one\r\n two\r\n\tthree\nB:x\r\n")).toEqual(["A:onetwothree", "B:x"]);
  });

  it("reads dates, refusing nonsense", () => {
    expect(parseIcsDate("20261018")).toEqual({ kind: "date", y: 2026, m: 10, d: 18 });
    expect(parseIcsDate("20261018T0930")).toMatchObject({ h: 9, mi: 30, s: 0, zone: "floating" });
    expect(parseIcsDate("2026-10-18")).toBeNull();
    expect(parseIcsDate("20261318")).toBeNull();
  });

  it("reads durations", () => {
    expect(parseDuration("P1D")).toBe(86_400);
    expect(parseDuration("P1W")).toBe(604_800);
    expect(parseDuration("PT45M")).toBe(2_700);
    expect(parseDuration("-PT15M")).toBe(-900);
    expect(parseDuration("soon")).toBeNull();
  });

  it("reads recurrence rules", () => {
    expect(
      parseRRule("FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU,-1FR;UNTIL=20271231T235959Z;WKST=SU"),
    ).toEqual({
      freq: "MONTHLY",
      interval: 2,
      until: { kind: "time", y: 2027, m: 12, d: 31, h: 23, mi: 59, s: 59, zone: "utc" },
      byDay: [
        { weekday: 2, ordinal: 2 },
        { weekday: 5, ordinal: -1 },
      ],
      weekStart: 0,
    });
    expect(parseRRule("FREQ=HOURLY")).toBeNull();
    expect(parseRRule("FREQ=WEEKLY;INTERVAL=0")).toMatchObject({ interval: 1, weekStart: 1 });
  });
});

import { describe, expect, it } from "vitest";

import { parseIcs } from "../ics";
import { occurrencesBetween } from "../recurrence";

const events = (...lines: string[]) =>
  parseIcs(["BEGIN:VCALENDAR", ...lines, "END:VCALENDAR"].join("\r\n")).events;

const event = (...lines: string[]) => [
  "BEGIN:VEVENT",
  `UID:${lines.join("|")}`,
  "SUMMARY:Test",
  ...lines,
  "END:VEVENT",
];

const utc = (iso: string) => Date.parse(iso);

/** The UTC start of each occurrence between two instants. */
const starts = (list: ReturnType<typeof events>, from: string, to: string) =>
  occurrencesBetween(list, utc(from), utc(to)).map((item) => new Date(item.start).toISOString());

/** The local day of each all-day occurrence. */
const localDays = (list: ReturnType<typeof events>, from: Date, to: Date) =>
  occurrencesBetween(list, from.getTime(), to.getTime()).map((item) => {
    const date = new Date(item.start);
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  });

describe("occurrencesBetween", () => {
  it("gives a single event once, if it overlaps the span", () => {
    const list = events(...event("DTSTART:20261020T080000Z", "DTEND:20261020T090000Z"));
    expect(starts(list, "2026-10-20T00:00:00Z", "2026-10-21T00:00:00Z")).toEqual([
      "2026-10-20T08:00:00.000Z",
    ]);
    // Still on at the span's start.
    expect(starts(list, "2026-10-20T08:30:00Z", "2026-10-20T10:00:00Z")).toHaveLength(1);
    expect(starts(list, "2026-10-21T00:00:00Z", "2026-10-22T00:00:00Z")).toEqual([]);
  });

  it("repeats daily with an interval, a count and an until", () => {
    const every2 = events(
      ...event("DTSTART:20261001T090000Z", "RRULE:FREQ=DAILY;INTERVAL=2;COUNT=3"),
    );
    expect(starts(every2, "2026-09-01T00:00:00Z", "2026-12-01T00:00:00Z")).toEqual([
      "2026-10-01T09:00:00.000Z",
      "2026-10-03T09:00:00.000Z",
      "2026-10-05T09:00:00.000Z",
    ]);
    const until = events(
      ...event("DTSTART:20261001T090000Z", "RRULE:FREQ=DAILY;UNTIL=20261003T090000Z"),
    );
    expect(starts(until, "2026-09-01T00:00:00Z", "2026-12-01T00:00:00Z")).toHaveLength(3);
  });

  it("counts occurrences before the span toward COUNT", () => {
    const list = events(...event("DTSTART:20261001T090000Z", "RRULE:FREQ=DAILY;COUNT=5"));
    expect(starts(list, "2026-10-04T00:00:00Z", "2026-12-01T00:00:00Z")).toEqual([
      "2026-10-04T09:00:00.000Z",
      "2026-10-05T09:00:00.000Z",
    ]);
  });

  it("repeats weekly on the BYDAY days, every other week", () => {
    // 2026-10-05 is a Monday.
    const list = events(
      ...event("DTSTART:20261005T170000Z", "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5"),
    );
    expect(starts(list, "2026-10-01T00:00:00Z", "2026-12-01T00:00:00Z")).toEqual([
      "2026-10-05T17:00:00.000Z",
      "2026-10-07T17:00:00.000Z",
      "2026-10-19T17:00:00.000Z",
      "2026-10-21T17:00:00.000Z",
      "2026-11-02T17:00:00.000Z",
    ]);
  });

  it("keeps a zoned weekly meeting at its local time across a daylight saving change", () => {
    const list = events(
      ...event(
        "DTSTART;TZID=Europe/Berlin:20261019T090000",
        "DTEND;TZID=Europe/Berlin:20261019T093000",
        "RRULE:FREQ=WEEKLY",
      ),
    );
    // Berlin leaves summer time on 2026-10-25.
    expect(starts(list, "2026-10-18T00:00:00Z", "2026-11-03T00:00:00Z")).toEqual([
      "2026-10-19T07:00:00.000Z",
      "2026-10-26T08:00:00.000Z",
      "2026-11-02T08:00:00.000Z",
    ]);
    const [first] = occurrencesBetween(
      list,
      utc("2026-10-19T00:00:00Z"),
      utc("2026-10-20T00:00:00Z"),
    );
    expect(first!.end - first!.start).toBe(30 * 60_000);
  });

  it("repeats monthly by day of month, skipping months without it, and by nth weekday", () => {
    const thirtyFirst = events(...event("DTSTART:20260131T120000Z", "RRULE:FREQ=MONTHLY;COUNT=4"));
    expect(starts(thirtyFirst, "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z")).toEqual([
      "2026-01-31T12:00:00.000Z",
      "2026-03-31T12:00:00.000Z",
      "2026-05-31T12:00:00.000Z",
      "2026-07-31T12:00:00.000Z",
    ]);
    const secondTuesday = events(
      ...event("DTSTART:20261013T120000Z", "RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=3"),
    );
    expect(starts(secondTuesday, "2026-10-01T00:00:00Z", "2027-06-01T00:00:00Z")).toEqual([
      "2026-10-13T12:00:00.000Z",
      "2026-11-10T12:00:00.000Z",
      "2026-12-08T12:00:00.000Z",
    ]);
    const lastFriday = events(
      ...event("DTSTART:20261030T120000Z", "RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=2"),
    );
    expect(starts(lastFriday, "2026-10-01T00:00:00Z", "2027-06-01T00:00:00Z")).toEqual([
      "2026-10-30T12:00:00.000Z",
      "2026-11-27T12:00:00.000Z",
    ]);
    const lastDay = events(
      ...event("DTSTART:20260131T120000Z", "RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3"),
    );
    expect(starts(lastDay, "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z")).toEqual([
      "2026-01-31T12:00:00.000Z",
      "2026-02-28T12:00:00.000Z",
      "2026-03-31T12:00:00.000Z",
    ]);
  });

  it("picks the last weekday of the month with BYSETPOS", () => {
    const list = events(
      ...event(
        "DTSTART:20261030T120000Z",
        "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3",
      ),
    );
    expect(starts(list, "2026-10-01T00:00:00Z", "2027-06-01T00:00:00Z")).toEqual([
      "2026-10-30T12:00:00.000Z",
      "2026-11-30T12:00:00.000Z",
      "2026-12-31T12:00:00.000Z",
    ]);
  });

  it("repeats yearly, as birthdays and nth-weekday holidays do", () => {
    const birthday = events(
      ...event("DTSTART;VALUE=DATE:19900315", "DTEND;VALUE=DATE:19900316", "RRULE:FREQ=YEARLY"),
    );
    expect(localDays(birthday, new Date(2026, 0, 1), new Date(2028, 0, 1))).toEqual([
      "2026-3-15",
      "2027-3-15",
    ]);
    const thanksgiving = events(
      ...event("DTSTART;VALUE=DATE:20241128", "RRULE:FREQ=YEARLY;INTERVAL=1;BYMONTH=11;BYDAY=4TH"),
    );
    expect(localDays(thanksgiving, new Date(2026, 0, 1), new Date(2028, 0, 1))).toEqual([
      "2026-11-26",
      "2027-11-25",
    ]);
  });

  it("leaves out EXDATEs and replaces moved occurrences, dropping cancelled ones", () => {
    const list = events(
      "BEGIN:VEVENT",
      "UID:series",
      "SUMMARY:Daily",
      "DTSTART:20261001T090000Z",
      "DTEND:20261001T091500Z",
      "RRULE:FREQ=DAILY;COUNT=5",
      "EXDATE:20261002T090000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:series",
      "SUMMARY:Daily (moved)",
      "RECURRENCE-ID:20261003T090000Z",
      "DTSTART:20261003T140000Z",
      "DTEND:20261003T141500Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:series",
      "RECURRENCE-ID:20261004T090000Z",
      "DTSTART:20261004T090000Z",
      "STATUS:CANCELLED",
      "END:VEVENT",
    );
    const found = occurrencesBetween(
      list,
      utc("2026-09-01T00:00:00Z"),
      utc("2026-12-01T00:00:00Z"),
    );
    expect(found.map((item) => [new Date(item.start).toISOString(), item.event.summary])).toEqual([
      ["2026-10-01T09:00:00.000Z", "Daily"],
      ["2026-10-03T14:00:00.000Z", "Daily (moved)"],
      ["2026-10-05T09:00:00.000Z", "Daily"],
    ]);
  });

  it("skips all-day EXDATEs and spans multi-day all-day events", () => {
    const list = events(
      ...event(
        "DTSTART;VALUE=DATE:20261005",
        "DTEND;VALUE=DATE:20261007",
        "RRULE:FREQ=WEEKLY;COUNT=3",
        "EXDATE;VALUE=DATE:20261012",
      ),
    );
    const found = occurrencesBetween(
      list,
      new Date(2026, 9, 1).getTime(),
      new Date(2026, 10, 1).getTime(),
    );
    expect(found.map((item) => new Date(item.start).getDate())).toEqual([5, 19]);
    expect(found.every((item) => item.allDay)).toBe(true);
    expect(new Date(found[0]!.end).getDate()).toBe(7);
    // On the second day of a two-day event, it is still there.
    expect(localDays(list, new Date(2026, 9, 6), new Date(2026, 9, 7))).toEqual(["2026-10-5"]);
  });

  it("finds today's occurrence of a long-running daily event quickly", () => {
    const list = events(...event("DTSTART;TZID=Europe/Berlin:20000103T090000", "RRULE:FREQ=DAILY"));
    const started = performance.now();
    expect(starts(list, "2026-10-18T00:00:00Z", "2026-10-19T00:00:00Z")).toEqual([
      "2026-10-18T07:00:00.000Z",
    ]);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

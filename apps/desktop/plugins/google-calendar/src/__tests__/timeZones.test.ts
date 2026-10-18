import { describe, expect, it } from "vitest";

import { toInstant } from "../dates";
import { parseIcs, resolveZone } from "../ics";
import { occurrencesBetween } from "../recurrence";

const feed = (...lines: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR"].join("\r\n");

/** A VTIMEZONE with US-style rules: daylight from the 2nd Sunday of March to the 1st of November. */
const usStyleZone = (tzid: string, standard = "-0800", daylight = "-0700") => [
  "BEGIN:VTIMEZONE",
  `TZID:${tzid}`,
  "BEGIN:STANDARD",
  "DTSTART:16010101T020000",
  `TZOFFSETFROM:${daylight}`,
  `TZOFFSETTO:${standard}`,
  "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:16010101T020000",
  `TZOFFSETFROM:${standard}`,
  `TZOFFSETTO:${daylight}`,
  "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
];

const iso = (instant: number) => new Date(instant).toISOString();

describe("resolveZone", () => {
  it("maps Windows zone names to IANA zones, ignoring case", () => {
    expect(resolveZone("W. Europe Standard Time")).toBe("Europe/Berlin");
    expect(resolveZone("Romance Standard Time")).toBe("Europe/Paris");
    expect(resolveZone("Pacific Standard Time")).toBe("America/Los_Angeles");
    expect(resolveZone("GMT Standard Time")).toBe("Europe/London");
    expect(resolveZone("Tokyo Standard Time")).toBe("Asia/Tokyo");
    expect(resolveZone('"eastern standard time"')).toBe("America/New_York");
  });

  it("keeps IANA ids, reads Mozilla-style ones and Outlook's UTC", () => {
    expect(resolveZone("Europe/Amsterdam")).toBe("Europe/Amsterdam");
    expect(resolveZone("America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos_Aires");
    expect(resolveZone("/mozilla.org/20050126_1/Europe/Berlin")).toBe("Europe/Berlin");
    expect(resolveZone("tzone://Microsoft/Utc")).toBe("utc");
    expect(resolveZone("UTC")).toBe("utc");
  });

  it("falls back to the feed's own zone, then to local time", () => {
    const own = { id: "vtz:abc", observances: [] };
    expect(resolveZone("Customized Time Zone", new Map([["Customized Time Zone", own]]))).toBe(
      "vtz:abc",
    );
    expect(resolveZone("Customized Time Zone")).toBe("floating");
  });

  it("reads Windows-named times in their real zone, across daylight saving", () => {
    const [berlin, seattle] = parseIcs(
      feed(
        "BEGIN:VEVENT",
        "UID:1",
        "DTSTART;TZID=W. Europe Standard Time:20261023T093000",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:2",
        "DTSTART;TZID=Pacific Standard Time:20261102T080000",
        "END:VEVENT",
      ),
    ).events;
    expect(berlin!.start).toMatchObject({ zone: "Europe/Berlin" });
    expect(iso(toInstant(berlin!.start))).toBe("2026-10-23T07:30:00.000Z");
    // The US leaves daylight saving on November 1, 2026.
    expect(iso(toInstant(seattle!.start))).toBe("2026-11-02T16:00:00.000Z");
  });
});

describe("VTIMEZONE fallback", () => {
  it("follows a custom zone's daylight saving rules", () => {
    const calendar = parseIcs(
      feed(
        ...usStyleZone("Customized Time Zone"),
        "BEGIN:VEVENT",
        "UID:weekly",
        "DTSTART;TZID=Customized Time Zone:20260302T090000",
        "DTEND;TZID=Customized Time Zone:20260302T093000",
        "RRULE:FREQ=DAILY;COUNT=10",
        "END:VEVENT",
      ),
    );
    expect(calendar.zones).toHaveLength(1);
    expect(calendar.events[0]!.start.kind === "time" && calendar.events[0]!.start.zone).toMatch(
      /^vtz:/,
    );
    const starts = occurrencesBetween(
      calendar.events,
      Date.parse("2026-03-06T00:00:00Z"),
      Date.parse("2026-03-11T00:00:00Z"),
    ).map((item) => iso(item.start));
    // March 8, 2026 is the second Sunday: 9:00 moves from 17:00 to 16:00 UTC.
    expect(starts).toEqual([
      "2026-03-06T17:00:00.000Z",
      "2026-03-07T17:00:00.000Z",
      "2026-03-08T16:00:00.000Z",
      "2026-03-09T16:00:00.000Z",
      "2026-03-10T16:00:00.000Z",
    ]);
  });

  it("switches back in the autumn and reads times before the first onset as standard time", () => {
    const [autumn, early] = parseIcs(
      feed(
        ...usStyleZone("Custom"),
        "BEGIN:VEVENT",
        "UID:a",
        "DTSTART;TZID=Custom:20261101T120000",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:b",
        "DTSTART;TZID=Custom:15000101T120000",
        "END:VEVENT",
      ),
    ).events;
    expect(iso(toInstant(autumn!.start))).toBe("2026-11-01T20:00:00.000Z");
    expect(toInstant(early!.start)).toBe(Date.UTC(1500, 0, 1, 20));
  });

  it("keeps zones that share a name in different feeds apart", () => {
    const at = (offsets: [string, string]) =>
      parseIcs(
        feed(
          ...usStyleZone("Customized Time Zone", ...offsets),
          "BEGIN:VEVENT",
          "UID:x",
          "DTSTART;TZID=Customized Time Zone:20260115T120000",
          "END:VEVENT",
        ),
      ).events[0]!.start;
    const pacific = at(["-0800", "-0700"]);
    const eastern = at(["-0500", "-0400"]);
    expect(iso(toInstant(pacific))).toBe("2026-01-15T20:00:00.000Z");
    expect(iso(toInstant(eastern))).toBe("2026-01-15T17:00:00.000Z");
  });

  it("prefers the Windows table to the feed's block for a Windows name", () => {
    const calendar = parseIcs(
      feed(
        ...usStyleZone("Pacific Standard Time"),
        "BEGIN:VEVENT",
        "UID:x",
        "DTSTART;TZID=Pacific Standard Time:20260115T120000",
        "END:VEVENT",
      ),
    );
    expect(calendar.events[0]!.start).toMatchObject({ zone: "America/Los_Angeles" });
    expect(calendar.zones).toEqual([]);
  });
});

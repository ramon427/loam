import { describe, expect, it } from "vitest";

import {
  carriedFrom,
  endedBefore,
  instancesBefore,
  isFirstInstance,
  seriesMovedLike,
  untilBefore,
} from "../recurrenceEdit";

const timed = (dateTime: string, timeZone = "Europe/Berlin") => ({ dateTime, timeZone });

describe("untilBefore", () => {
  it("ends a timed series a second before the instance, in UTC", () => {
    expect(untilBefore(timed("2026-10-21T09:00:00+02:00"))).toBe("20261021T065959Z");
    // After the clocks change, the same 9:00 is an hour later in UTC.
    expect(untilBefore(timed("2026-10-28T09:00:00+01:00"))).toBe("20261028T075959Z");
  });

  it("ends an all-day series the day before, as a date", () => {
    expect(untilBefore({ date: "2026-11-01" })).toBe("20261031");
    expect(untilBefore({ date: "2026-03-01" })).toBe("20260228");
  });
});

describe("endedBefore and carriedFrom", () => {
  const weekly = {
    start: timed("2026-10-05T09:00:00+02:00"),
    recurrence: [
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10",
      "EXDATE;TZID=Europe/Berlin:20261012T090000,20261026T090000",
    ],
  };
  const pivot = timed("2026-10-19T09:00:00+02:00");

  it("puts UNTIL in place of COUNT and keeps only the exceptions before the pivot", () => {
    expect(endedBefore(weekly, pivot)).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261019T065959Z",
      "EXDATE;TZID=Europe/Berlin:20261012T090000",
    ]);
  });

  it("replaces an UNTIL already there", () => {
    expect(
      endedBefore(
        { start: weekly.start, recurrence: ["RRULE:FREQ=DAILY;UNTIL=20261231T230000Z"] },
        pivot,
      ),
    ).toEqual(["RRULE:FREQ=DAILY;UNTIL=20261019T065959Z"]);
  });

  it("carries on with COUNT lowered by the instances before, and the later exceptions", () => {
    expect(instancesBefore(weekly, pivot)).toBe(2);
    expect(carriedFrom(weekly, pivot, 2)).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=8",
      "EXDATE;TZID=Europe/Berlin:20261026T090000",
    ]);
  });

  it("ends an all-day series with a date and counts its days", () => {
    const daily = { start: { date: "2026-10-01" }, recurrence: ["RRULE:FREQ=DAILY;COUNT=30"] };
    expect(endedBefore(daily, { date: "2026-10-11" })).toEqual(["RRULE:FREQ=DAILY;UNTIL=20261010"]);
    expect(instancesBefore(daily, { date: "2026-10-11" })).toBe(10);
    expect(carriedFrom(daily, { date: "2026-10-11" }, 10)).toEqual(["RRULE:FREQ=DAILY;COUNT=20"]);
  });

  it("knows the first instance, where this and following is all", () => {
    expect(isFirstInstance(weekly, { originalStartTime: weekly.start })).toBe(true);
    expect(isFirstInstance(weekly, { originalStartTime: pivot })).toBe(false);
  });
});

describe("seriesMovedLike", () => {
  it("moves the series' start like the instance, in wall-clock time, with the new length", () => {
    const moved = seriesMovedLike(
      {
        start: timed("2026-10-05T09:00:00+02:00"),
        end: timed("2026-10-05T09:30:00+02:00"),
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
      },
      // The instance on Monday the 26th (after the clocks change) moves to Tuesday 10:00.
      { start: timed("2026-10-26T09:00:00+01:00") },
      { start: timed("2026-10-27T10:00:00+01:00"), end: timed("2026-10-27T11:00:00+01:00") },
    );
    // Tuesday the 6th, 10:00 in summer time, an hour long, weekly on Tuesdays.
    expect(moved.start).toEqual({
      dateTime: "2026-10-06T08:00:00.000Z",
      timeZone: "Europe/Berlin",
      date: null,
    });
    expect(moved.end!.dateTime).toBe("2026-10-06T09:00:00.000Z");
    expect(moved.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TU"]);
  });

  it("moves an all-day series by days", () => {
    const moved = seriesMovedLike(
      {
        start: { date: "2026-10-05" },
        end: { date: "2026-10-06" },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"],
      },
      { start: { date: "2026-10-12" } },
      { start: { date: "2026-10-14" }, end: { date: "2026-10-16" } },
    );
    expect(moved.start).toEqual({ date: "2026-10-07", dateTime: null, timeZone: null });
    expect(moved.end).toEqual({ date: "2026-10-09", dateTime: null, timeZone: null });
    expect(moved.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=WE,FR"]);
  });
});

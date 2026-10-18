import { describe, expect, it } from "vitest";

import { createGoogleApi } from "../googleApi";
import type { GEvent } from "../googleEvents";
import { deleteRecurring, saveRecurring } from "../recurringChanges";
import { createFakeGoogleCalendar, sendTo } from "../testing/fakeGoogleCalendar";

const CAL = "me@example.com";
const at = (iso: string) => ({ dateTime: iso, timeZone: "UTC" });

const setup = (recurrence = ["RRULE:FREQ=DAILY;COUNT=5"]) => {
  const fake = createFakeGoogleCalendar();
  const api = createGoogleApi({ send: sendTo(fake), sleep: async () => undefined });
  const master = fake.add(CAL, {
    summary: "Standup",
    start: at("2026-10-12T09:00:00Z"),
    end: at("2026-10-12T09:15:00Z"),
    recurrence,
  });
  const instance = (day: number) =>
    fake.instances(CAL).find((event) => event.start?.dateTime?.startsWith(`2026-10-${day}`))!;
  const shown = () =>
    fake
      .instances(CAL)
      .map((event: GEvent) => `${event.start!.dateTime!.slice(5, 16)} ${event.summary}`);
  return { fake, api, master, instance, shown };
};

describe("changing a recurring event", () => {
  it("changes only this one", async () => {
    const { api, instance, shown } = setup();
    await saveRecurring(api, {
      calendarId: CAL,
      instance: instance(14),
      patch: { summary: "Planning" },
      scope: "this",
    });
    expect(shown()).toEqual([
      "10-12T09:00 Standup",
      "10-13T09:00 Standup",
      "10-14T09:00 Planning",
      "10-15T09:00 Standup",
      "10-16T09:00 Standup",
    ]);
  });

  it("moves all of them by the same amount", async () => {
    const { api, instance, shown } = setup();
    await saveRecurring(api, {
      calendarId: CAL,
      instance: instance(14),
      patch: { start: at("2026-10-14T10:30:00Z"), end: at("2026-10-14T11:00:00Z") },
      scope: "all",
    });
    expect(shown()).toEqual([
      "10-12T10:30 Standup",
      "10-13T10:30 Standup",
      "10-14T10:30 Standup",
      "10-15T10:30 Standup",
      "10-16T10:30 Standup",
    ]);
  });

  it("splits the series for this and following, keeping COUNT's total", async () => {
    const { api, fake, instance, shown, master } = setup();
    await saveRecurring(api, {
      calendarId: CAL,
      instance: instance(14),
      patch: {
        summary: "Planning",
        start: at("2026-10-14T10:00:00Z"),
        end: at("2026-10-14T10:30:00Z"),
      },
      scope: "following",
    });
    expect(shown()).toEqual([
      "10-12T09:00 Standup",
      "10-13T09:00 Standup",
      "10-14T10:00 Planning",
      "10-15T10:00 Planning",
      "10-16T10:00 Planning",
    ]);
    const old = fake.stored(CAL).find((event) => event.id === master.id)!;
    expect(old.recurrence).toEqual(["RRULE:FREQ=DAILY;UNTIL=20261014T085959Z"]);
  });

  it("drops the changed instances after the split, which the new series replaces", async () => {
    const { api, fake, instance, shown } = setup();
    await saveRecurring(api, {
      calendarId: CAL,
      instance: instance(15),
      patch: { summary: "Moved one" },
      scope: "this",
    });
    await saveRecurring(api, {
      calendarId: CAL,
      instance: instance(14),
      patch: { summary: "Retro" },
      scope: "following",
    });
    expect(shown()).toEqual([
      "10-12T09:00 Standup",
      "10-13T09:00 Standup",
      "10-14T09:00 Retro",
      "10-15T09:00 Retro",
      "10-16T09:00 Retro",
    ]);
    expect(
      fake
        .stored(CAL)
        .filter((event) => event.summary === "Moved one" && event.status !== "cancelled"),
    ).toEqual([]);
  });

  it("treats this and following on the first instance as all of them", async () => {
    const { api, fake, instance } = setup();
    await saveRecurring(api, {
      calendarId: CAL,
      instance: instance(12),
      patch: { summary: "Daily" },
      scope: "following",
    });
    expect(fake.stored(CAL)).toHaveLength(1);
    expect(fake.instances(CAL).every((event) => event.summary === "Daily")).toBe(true);
  });
});

describe("deleting a recurring event", () => {
  it("deletes only this one, this and following, or all", async () => {
    const one = setup();
    await deleteRecurring(one.api, { calendarId: CAL, instance: one.instance(13), scope: "this" });
    expect(one.shown()).toEqual([
      "10-12T09:00 Standup",
      "10-14T09:00 Standup",
      "10-15T09:00 Standup",
      "10-16T09:00 Standup",
    ]);

    const following = setup();
    await deleteRecurring(following.api, {
      calendarId: CAL,
      instance: following.instance(14),
      scope: "following",
    });
    expect(following.shown()).toEqual(["10-12T09:00 Standup", "10-13T09:00 Standup"]);

    const all = setup();
    await deleteRecurring(all.api, { calendarId: CAL, instance: all.instance(14), scope: "all" });
    expect(all.shown()).toEqual([]);
  });
});

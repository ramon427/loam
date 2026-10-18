import { describe, expect, it } from "vitest";

import { createChanges } from "../changes";
import { createGoogleApi } from "../googleApi";
import type { GEvent } from "../googleEvents";
import { createSyncEngine } from "../sync";
import { createFakeGoogleCalendar, sendTo } from "../testing/fakeGoogleCalendar";

const CAL = "me@example.com";
const at = (iso: string) => ({ dateTime: iso, timeZone: "UTC" });
const FROM = Date.parse("2026-10-12T00:00:00Z");
const TO = Date.parse("2026-10-19T00:00:00Z");

const setup = async (answers: (string | null)[] = []) => {
  const fake = createFakeGoogleCalendar();
  const api = createGoogleApi({ send: sendTo(fake), sleep: async () => undefined });
  const engine = createSyncEngine({ api, load: async () => null, save: async () => undefined });
  const asked: string[] = [];
  const notes: { text: string; undo?: () => void }[] = [];
  /** Lunch's start each time the view was drawn. */
  const drawn: (string | null | undefined)[] = [];
  const changes = createChanges({
    api,
    engine,
    ask: async (question) => {
      asked.push(question.title);
      return answers.shift() ?? null;
    },
    notify: (text, options) => notes.push({ text, undo: options?.undo }),
    redraw: () => drawn.push(engine.get(CAL, lunch.id)?.start?.dateTime),
    resync: async (calendarId) => {
      await engine.sync(calendarId, FROM, TO);
    },
  });
  const lunch: GEvent = fake.add(CAL, {
    summary: "Lunch",
    start: at("2026-10-14T12:00:00Z"),
    end: at("2026-10-14T13:00:00Z"),
  });
  await engine.sync(CAL, FROM, TO);
  const shown = () => engine.get(CAL, lunch.id);
  return { fake, api, engine, changes, asked, notes, lunch, shown, drawn };
};

describe("changes", () => {
  it("shows a move at once, and puts it back when Google refuses it", async () => {
    const { fake, changes, lunch, shown, notes, drawn } = await setup();
    fake.failNext(403, "forbidden", "PATCH");
    await changes.move(
      { calendarId: CAL, event: lunch },
      at("2026-10-14T15:00:00Z"),
      at("2026-10-14T16:00:00Z"),
      "Event moved",
    );
    expect(drawn).toEqual(["2026-10-14T15:00:00Z", "2026-10-14T12:00:00Z"]);
    expect(shown()?.start?.dateTime).toBe("2026-10-14T12:00:00Z");
    expect(notes.at(-1)?.text).toBe("Google Calendar didn't allow that change.");
  });

  it("asks to reload or overwrite an event changed elsewhere", async () => {
    const reload = await setup(["reload"]);
    await reload.api.patch(CAL, reload.lunch.id, { summary: "Team lunch" });
    await reload.changes.update({ calendarId: CAL, event: reload.lunch }, { location: "Cafe" });
    expect(reload.asked).toEqual(["This event changed in Google Calendar"]);
    expect(reload.shown()?.summary).toBe("Team lunch");
    expect(reload.shown()?.location).toBeUndefined();

    const overwrite = await setup(["overwrite"]);
    await overwrite.api.patch(CAL, overwrite.lunch.id, { summary: "Team lunch" });
    await overwrite.changes.update(
      { calendarId: CAL, event: overwrite.lunch },
      { location: "Cafe" },
    );
    expect(overwrite.shown()).toMatchObject({ summary: "Team lunch", location: "Cafe" });
  });

  it("undoes the last move, in Google too", async () => {
    const { fake, changes, lunch, notes } = await setup();
    await changes.move(
      { calendarId: CAL, event: lunch },
      at("2026-10-14T15:00:00Z"),
      at("2026-10-14T16:00:00Z"),
      "Event moved",
    );
    expect(notes.at(-1)?.text).toBe("Event moved");
    await changes.undo();
    const stored = fake.stored(CAL).find((event) => event.id === lunch.id)!;
    expect(stored.start?.dateTime).toBe("2026-10-14T12:00:00Z");
  });

  it("undoes a deletion and a new event", async () => {
    const { fake, changes, lunch, shown } = await setup();
    await changes.remove({ calendarId: CAL, event: lunch });
    expect(shown()).toBeNull();
    await changes.undo();
    expect(shown()?.status).toBe("confirmed");

    const made = await changes.create(CAL, {
      summary: "Coffee",
      start: at("2026-10-15T10:00:00Z"),
      end: at("2026-10-15T10:30:00Z"),
    });
    expect(fake.instances(CAL).map((event) => event.summary)).toContain("Coffee");
    await changes.undo();
    expect(fake.instances(CAL).map((event) => event.summary)).not.toContain("Coffee");
    expect(made?.summary).toBe("Coffee");
  });

  it("asks whether to email guests, and calls the change off if dismissed", async () => {
    const { fake, changes, asked } = await setup([null]);
    const meeting = fake.add(CAL, {
      summary: "Review",
      start: at("2026-10-15T10:00:00Z"),
      end: at("2026-10-15T11:00:00Z"),
      attendees: [{ email: CAL, self: true }, { email: "sam@example.com" }],
    });
    await changes.update({ calendarId: CAL, event: meeting }, { summary: "Design review" });
    expect(asked).toEqual(["Send update emails to the guests?"]);
    expect(fake.stored(CAL).find((event) => event.id === meeting.id)?.summary).toBe("Review");
  });
});

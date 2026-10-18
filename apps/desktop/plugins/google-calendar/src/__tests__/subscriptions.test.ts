import { describe, expect, it } from "vitest";

import {
  addSubscription,
  defaultName,
  migrateSubscriptions,
  normalizeUrl,
  readSubscriptions,
  SUBSCRIPTION_COLORS,
  urlProblem,
} from "../subscriptions";

const OUTLOOK =
  "https://outlook.office365.com/owa/calendar/0f1e2d3c4b5a@contoso.example/a1b2c3d4e5f6/calendar.ics";
const GOOGLE =
  "https://calendar.google.com/calendar/ical/me%40gmail.com/private-0123abcd/basic.ics";

describe("subscription addresses", () => {
  it("reads webcal links over https and trims what was pasted", () => {
    expect(normalizeUrl(`  ${OUTLOOK.replace("https://", "webcal://")}\n`)).toBe(OUTLOOK);
    expect(normalizeUrl("webcals://outlook.live.com/owa/x/calendar.ics")).toBe(
      "https://outlook.live.com/owa/x/calendar.ics",
    );
  });

  it("takes Outlook's and Google's hosts, and refuses others before fetching", () => {
    expect(urlProblem(OUTLOOK)).toBeNull();
    expect(urlProblem("https://outlook.office.com/owa/calendar/x/calendar.ics")).toBeNull();
    expect(urlProblem("https://outlook.live.com/owa/calendar/x/calendar.ics")).toBeNull();
    expect(urlProblem(GOOGLE)).toBeNull();
    expect(urlProblem("http://outlook.office365.com/x.ics")).toMatch(/https/);
    expect(urlProblem("https://outlook.office365.com.evil.example/x.ics")).toMatch(/Outlook/);
    expect(urlProblem("https://example.com/team.ics")).toMatch(/Outlook.*Google/);
    expect(urlProblem("not a link")).toMatch(/isn't a web address/);
  });

  it("names a calendar after its feed, except Outlook's generic name", () => {
    expect(defaultName(OUTLOOK, "Calendar")).toBe("Work calendar");
    expect(defaultName(OUTLOOK, "")).toBe("Work calendar");
    expect(defaultName(OUTLOOK, "Project Falcon")).toBe("Project Falcon");
    expect(defaultName(GOOGLE, "")).toBe("Google calendar");
  });
});

describe("the subscription list", () => {
  it("gives each new calendar its own id and the next free color", () => {
    let list = addSubscription([], OUTLOOK, "Work");
    list = addSubscription(list, GOOGLE, "Family");
    expect(list.map(({ id, color, enabled }) => ({ id, color, enabled }))).toEqual([
      { id: "s1", color: SUBSCRIPTION_COLORS[0], enabled: true },
      { id: "s2", color: SUBSCRIPTION_COLORS[1], enabled: true },
    ]);
    const afterRemoval = addSubscription(list.slice(1), OUTLOOK, "Again");
    expect(afterRemoval.at(-1)).toMatchObject({ id: "s3", color: SUBSCRIPTION_COLORS[0] });
  });

  it("keeps only well-formed entries from storage", () => {
    expect(readSubscriptions(null)).toBeNull();
    expect(
      readSubscriptions([
        { id: "s1", url: OUTLOOK, name: "Work", color: "#f4511e", enabled: false },
        { id: "s1", url: GOOGLE },
        { url: GOOGLE },
        "junk",
        { id: "s2", url: GOOGLE, name: " ", color: "red" },
      ]),
    ).toEqual([
      { id: "s1", url: OUTLOOK, name: "Work", color: "#f4511e", enabled: false },
      { id: "s2", url: GOOGLE, name: "Calendar", color: SUBSCRIPTION_COLORS[1], enabled: true },
    ]);
  });
});

describe("migrateSubscriptions", () => {
  it("turns the old space-separated setting into subscriptions, once", () => {
    const old = `${GOOGLE} webcal://calendar.google.com/calendar/ical/b/basic.ics,${GOOGLE}`;
    const { list, changed } = migrateSubscriptions(null, old);
    expect(changed).toBe(true);
    expect(list).toEqual([
      {
        id: "s1",
        url: GOOGLE,
        name: "Google calendar",
        color: SUBSCRIPTION_COLORS[0],
        enabled: true,
        autoName: true,
      },
      {
        id: "s2",
        url: "https://calendar.google.com/calendar/ical/b/basic.ics",
        name: "Google calendar",
        color: SUBSCRIPTION_COLORS[1],
        enabled: true,
        autoName: true,
      },
    ]);
    // Once a list is stored, the old setting is left alone, even if the list is empty.
    expect(migrateSubscriptions(list.slice(1), old)).toEqual({
      list: list.slice(1),
      changed: false,
    });
    expect(migrateSubscriptions([], old)).toEqual({ list: [], changed: false });
  });

  it("starts empty without an old setting", () => {
    expect(migrateSubscriptions(null, "")).toEqual({ list: [], changed: true });
    expect(migrateSubscriptions(null, undefined)).toEqual({ list: [], changed: true });
  });
});

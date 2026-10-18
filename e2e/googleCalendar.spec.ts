import type { Locator, Page } from "@playwright/test";

import { expect, test, type LoamApp } from "./app";
import { startFakeGoogle } from "./fakeGoogle";
import { openSettings, sidebar } from "./notes";

/*
 * The Google Calendar plugin signed in to a fake Google on a local port (LOAM_E2E_GOOGLE_URL):
 * sign-in, the calendar toggles, and making, moving, resizing, editing and deleting events,
 * with undo and a recurring event changed from one instance on.
 */

let google: Awaited<ReturnType<typeof startFakeGoogle>>;

test.beforeAll(async () => {
  google = await startFakeGoogle();
  process.env.LOAM_E2E_GOOGLE_URL = google.url;
});

test.afterEach(() => google.reset());

test.afterAll(async () => {
  delete process.env.LOAM_E2E_GOOGLE_URL;
  await google.close();
});

const ME = "me@example.com";
const HOUR = 48;

/** Today at a local hour, as Google writes it. */
const todayAt = (hour: number, minute = 0) => {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return { dateTime: date.toISOString(), timeZone: "UTC" };
};
const localTimeOf = (dateTime: string | null | undefined) => {
  const date = new Date(dateTime ?? "");
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
/** Monday of this week, at a local hour, as the calendar's week starts on Monday. */
const mondayAt = (hour: number) => {
  const date = new Date();
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  date.setHours(hour, 0, 0, 0);
  return date;
};

const signIn = async (loam: LoamApp) => {
  const { window } = loam;
  await loam.visitBrowserLinks();
  const settings = await openSettings(window, "Plugins");
  const restricted = settings.getByRole("checkbox", { name: "Restricted mode" });
  await expect(restricted).toBeEnabled();
  if ((await restricted.getAttribute("data-state")) === "checked") await restricted.click();
  await settings.getByRole("checkbox", { name: "Turn on Google Calendar" }).click();
  const consent = window.getByRole("dialog", { name: "Turn on Google Calendar?" });
  await expect(
    consent.getByText(/See and change the events in your Google calendars/),
  ).toBeVisible();
  await consent.getByRole("button", { name: "Turn on" }).click();

  const account = settings.getByRole("region", { name: "Google account" });
  await expect(account.getByTestId("google-account-status")).toHaveText("Not signed in");
  await account
    .getByRole("textbox", { name: "Client ID" })
    .fill("123-test.apps.googleusercontent.com");
  await account.getByRole("textbox", { name: "Client ID" }).press("Tab");
  await account.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(account.getByTestId("google-account-status")).toHaveText(`Signed in as ${ME}`);
  await window.getByRole("button", { name: /Back to notes/ }).click();
  await sidebar(window).getByRole("button", { name: "Calendar" }).click();
  return window.getByRole("region", { name: "Calendar" }).first();
};

const eventIn = (view: Locator, title: string) =>
  view.getByRole("button", { name: new RegExp(`^${title},`) });

/** Drags with the mouse from one point to another in small steps, as a hand does. */
const drag = async (window: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
  await window.mouse.move(from.x, from.y);
  await window.mouse.down();
  await window.mouse.move(from.x, from.y + (to.y > from.y ? 4 : -4), { steps: 2 });
  await window.mouse.move(to.x, to.y, { steps: 8 });
  await window.mouse.up();
};

/** Scrolls the time grid so the event is at its top, with the afternoon below it. */
const showAtTop = (event: Locator) =>
  event.evaluate((element) => element.scrollIntoView({ block: "start" }));

const stored = (title: string) =>
  google.calendar
    .stored(ME)
    .find((event) => event.summary === title && event.status !== "cancelled");

test("signs in to Google, then makes, moves and resizes events by dragging, and undoes", async ({
  loam,
}) => {
  google.calendar.add(ME, { summary: "Lunch", start: todayAt(12), end: todayAt(13) });
  const view = await signIn(loam);
  const { window } = loam;
  const lunch = eventIn(view, "Lunch");
  await expect(lunch).toBeVisible();
  await expect(view.getByRole("button", { name: "Week", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Drag out 14:00–15:00 under lunch, and name it in the quick editor.
  await showAtTop(lunch);
  const box = (await lunch.boundingBox())!;
  const x = box.x + box.width / 2;
  await drag(window, { x, y: box.y + 2 * HOUR + 2 }, { x, y: box.y + 3 * HOUR - 2 });
  const popover = view.getByRole("dialog", { name: "Event" });
  await popover.getByRole("textbox", { name: "Title" }).fill("Focus time");
  await popover.getByRole("textbox", { name: "Title" }).press("Enter");
  await expect(eventIn(view, "Focus time")).toBeVisible();
  await expect.poll(() => localTimeOf(stored("Focus time")?.start?.dateTime)).toBe("14:00");
  expect(localTimeOf(stored("Focus time")?.end?.dateTime)).toBe("15:00");

  // Move lunch an hour later, then stretch it by half an hour.
  await drag(window, { x, y: box.y + 10 }, { x, y: box.y + HOUR + 10 });
  await expect.poll(() => localTimeOf(stored("Lunch")?.start?.dateTime)).toBe("13:00");
  const moved = (await lunch.boundingBox())!;
  await drag(
    window,
    { x, y: moved.y + moved.height - 3 },
    { x, y: moved.y + moved.height - 3 + HOUR / 2 },
  );
  await expect.poll(() => localTimeOf(stored("Lunch")?.end?.dateTime)).toBe("14:30");
  expect(localTimeOf(stored("Lunch")?.start?.dateTime)).toBe("13:00");

  // Undo puts the length back, in Google too.
  await window.getByRole("button", { name: "Undo" }).last().click();
  await expect.poll(() => localTimeOf(stored("Lunch")?.end?.dateTime)).toBe("14:00");
  await expect(lunch).toHaveAccessibleName(/1:00\sPM\s–\s2:00\sPM/);
});

test("switches a calendar off and on, and deletes an event with undo", async ({ loam }) => {
  google.calendar.add(ME, { summary: "Dentist", start: todayAt(10), end: todayAt(11) });
  const view = await signIn(loam);
  const { window } = loam;
  const dentist = eventIn(view, "Dentist");
  await expect(dentist).toBeVisible();

  const toggle = view.getByRole("checkbox", { name: ME });
  await toggle.click();
  await expect(dentist).toBeHidden();
  await toggle.click();
  await expect(dentist).toBeVisible();

  await dentist.click();
  const popover = view.getByRole("dialog", { name: "Event" });
  await expect(popover.getByRole("heading", { name: "Dentist" })).toBeVisible();
  await window.keyboard.press("Delete");
  await expect(dentist).toBeHidden();
  await expect.poll(() => stored("Dentist")).toBeUndefined();
  await window.getByRole("button", { name: "Undo" }).last().click();
  await expect(dentist).toBeVisible();
  await expect.poll(() => stored("Dentist")?.summary).toBe("Dentist");
});

test("edits an event in the full editor, and changes a recurring one from an instance on", async ({
  loam,
}) => {
  const monday = mondayAt(9);
  google.calendar.add(ME, {
    summary: "Standup",
    start: { dateTime: monday.toISOString(), timeZone: "UTC" },
    end: { dateTime: new Date(monday.getTime() + 15 * 60_000).toISOString(), timeZone: "UTC" },
    recurrence: ["RRULE:FREQ=DAILY;COUNT=5"],
  });
  google.calendar.add(ME, { summary: "Review", start: todayAt(15), end: todayAt(16) });
  const view = await signIn(loam);
  const { window } = loam;
  await expect(eventIn(view, "Standup")).toHaveCount(5);

  // The full editor: a new title and a place.
  await eventIn(view, "Review").dblclick();
  await view.getByRole("textbox", { name: "Title" }).fill("Design review");
  await view.getByRole("textbox", { name: "Location" }).fill("Room 2");
  await view.getByRole("button", { name: "Save" }).click();
  await expect(eventIn(view, "Design review")).toBeVisible();
  await expect.poll(() => stored("Design review")?.location).toBe("Room 2");

  // Wednesday's standup and the ones after it become "Planning".
  await eventIn(view, "Standup").nth(2).click();
  await expect(view.getByRole("dialog", { name: "Event" }).getByText("Repeats")).toBeVisible();
  await window.keyboard.press("Enter");
  await view.getByRole("textbox", { name: "Title" }).fill("Planning");
  await view.getByRole("button", { name: "Save" }).click();
  const scope = window.getByRole("dialog", { name: "Edit recurring event" });
  await expect(scope.getByRole("button", { name: "This event" })).toBeVisible();
  await scope.getByRole("button", { name: "This and following events" }).click();
  await expect(eventIn(view, "Planning")).toHaveCount(3);
  await expect(eventIn(view, "Standup")).toHaveCount(2);
  expect(
    google.calendar
      .instances(ME)
      .filter((event) => event.summary === "Planning" || event.summary === "Standup")
      .map((event) => event.summary),
  ).toEqual(["Standup", "Standup", "Planning", "Planning", "Planning"]);
});

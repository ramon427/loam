import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { expect, test, type LoamApp } from "./app";
import { appendToBody, createNote, expectSaved, openSettings, sidebar } from "./notes";

const EXAMPLES = join(import.meta.dirname, "..", "examples", "plugins");

test.beforeAll(() => {
  execFileSync(process.execPath, [join(EXAMPLES, "build.mjs")], { stdio: "inherit" });
});

const install = (loam: LoamApp, id: string) =>
  cpSync(join(EXAMPLES, id), join(loam.dataDirectory, "plugins", id), {
    recursive: true,
    filter: (source) => !source.includes(`${id}/src`),
  });

const pluginsPage = async (window: Page) => {
  const settings = await openSettings(window, "Plugins");
  await expect(settings.getByRole("checkbox", { name: "Restricted mode" })).toBeEnabled();
  return settings;
};

/** Switches restricted mode off and turns a plugin on, allowing what it asks for. */
const turnOn = async (window: Page, name: string) => {
  const settings = await pluginsPage(window);
  const restricted = settings.getByRole("checkbox", { name: "Restricted mode" });
  if ((await restricted.getAttribute("data-state")) === "checked") await restricted.click();
  await expect(restricted).toHaveAttribute("data-state", "unchecked");
  await settings.getByRole("checkbox", { name: `Turn on ${name}` }).click();
  const dialog = window.getByRole("dialog", { name: `Turn on ${name}?` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Turn on" }).click();
  await expect(dialog).toBeHidden();
  return settings;
};

const backToNotes = (window: Page) => window.getByRole("button", { name: /Back to notes/ }).click();

test("a plugin asks before it runs, then draws into the note header", async ({ loam }) => {
  const { window } = loam;
  install(loam, "word-count");
  const settings = await pluginsPage(window);
  await expect(settings.getByText("Word count 1.0.0")).toBeVisible();
  await expect(settings.getByRole("checkbox", { name: "Restricted mode" })).toHaveAttribute(
    "data-state",
    "checked",
  );

  await turnOn(window, "Word count");
  await expect(settings.getByTestId("plugin-status-word-count")).toHaveText("Running");
  const saved = JSON.parse(readFileSync(join(loam.dataDirectory, "plugins.json"), "utf8"));
  expect(saved.plugins["word-count"]).toMatchObject({ enabled: true, granted: ["notes:read"] });

  await backToNotes(window);
  await createNote(window, { title: "Counted", body: "one two three" });
  await expectSaved(window, "Counted", "one two three");
  await expect(window.locator('[data-plugin-slot="note.header"]')).toHaveText("3 words");
});

test("plugin commands run from the palette and add slash menu items", async ({ loam }) => {
  const { window } = loam;
  install(loam, "daily-note");
  await turnOn(window, "Daily note");
  await backToNotes(window);

  await window.keyboard.press("ControlOrMeta+Shift+P");
  const palette = window.getByRole("dialog", { name: "Commands" });
  await palette.getByRole("combobox", { name: "Search commands" }).fill("today");
  await expect(palette.getByRole("option", { name: /Open today's note/ })).toBeVisible();
  await window.keyboard.press("Enter");

  const today = new Date().toISOString().slice(0, 10);
  await expect(sidebar(window).getByText(today, { exact: true })).toBeVisible();
  await expect(window.getByRole("heading", { name: "Plan" })).toBeVisible();

  await createNote(window, { title: "Dated", body: "Written on" });
  await appendToBody(window, "");
  await window.keyboard.press("Enter");
  await window.keyboard.type("/today");
  const slashMenu = window.locator("#bn-suggestion-menu");
  await expect(slashMenu.getByRole("option", { name: /Today's date/ })).toBeVisible();
  await window.keyboard.press("Enter");
  await expectSaved(window, "Dated", today);
});

test("a plugin pane opens from the sidebar and keeps state as its buttons are pressed", async ({
  loam,
}) => {
  const { window } = loam;
  install(loam, "focus-timer");
  await turnOn(window, "Focus timer");
  await backToNotes(window);

  await sidebar(window).getByRole("button", { name: "Focus timer" }).click();
  const pane = window.getByRole("region", { name: "Focus timer" });
  await expect(pane.getByText("25:00")).toBeVisible();
  await pane.getByRole("button", { name: "Start" }).click();
  await expect(pane.getByText("25:00")).toBeHidden({ timeout: 5_000 });
  await pane.getByRole("button", { name: "Pause" }).click();
  await pane.getByRole("button", { name: "Reset" }).click();
  await expect(pane.getByText("25:00")).toBeVisible();
  await pane.getByRole("button", { name: "Close Focus timer" }).click();
  await expect(pane).toBeHidden();
});

test("a plugin's worker has no network of its own, and can't use what it wasn't granted", async ({
  loam,
}) => {
  const { window } = loam;
  const folder = join(loam.dataDirectory, "plugins", "probe");
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "manifest.json"),
    JSON.stringify({ id: "probe", name: "Probe", version: "1.0.0", apiVersion: 1 }),
  );
  writeFileSync(
    join(folder, "main.js"),
    `export const register = (on) => {
      on("app.ready", async ($) => {
        const attempt = async (run) => { try { await run(); return "allowed"; } catch (error) { return "blocked"; } };
        await $.store.set("result", {
          fetch: typeof fetch,
          importRemote: await attempt(() => import("https://example.com/x.js")),
          readNotes: await attempt(() => $.notes.list()),
          netFetch: await attempt(() => $.net.fetch("https://example.com/")),
        });
      });
    };`,
  );
  await turnOn(window, "Probe");

  await expect
    .poll(() => {
      try {
        return JSON.parse(
          readFileSync(join(loam.dataDirectory, "plugin-data", "probe.json"), "utf8"),
        );
      } catch {
        return null;
      }
    })
    .toEqual({
      result: {
        fetch: "undefined",
        importRemote: "blocked",
        readNotes: "blocked",
        netFetch: "blocked",
      },
    });
});

test("a theme applies before the first paint after a restart, and theme files join the presets", async ({
  loam,
}) => {
  const { window } = loam;
  const settings = await openSettings(window, "Appearance");
  await settings.getByTestId("theme-card-nord").click();
  await expect(settings.getByTestId("theme-card-nord")).toHaveAttribute("aria-checked", "true");

  mkdirSync(join(loam.dataDirectory, "themes"), { recursive: true });
  writeFileSync(
    join(loam.dataDirectory, "themes", "dusk.json"),
    JSON.stringify({
      id: "dusk",
      name: "Dusk",
      dark: { tokens: { bg: "#101018" } },
      light: { tokens: { bg: "#f0f0f8" } },
    }),
  );
  await expect(settings.getByTestId("theme-card-dusk")).toBeVisible();

  await loam.restart();
  // Read as soon as the page has a document, before the app's own scripts run.
  const early = await loam.window.evaluate(() =>
    document.getElementById("loam-theme")?.textContent?.includes("#2e3440"),
  );
  expect(early).toBe(true);
  const background = await loam.window.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--app-bg").trim(),
  );
  expect(["#2e3440", "#eceff4"]).toContain(background);
});

const CALENDAR_URL =
  "https://calendar.google.com/calendar/ical/me%40example.com/private-0123abcd/basic.ics";

test("the built-in calendar shows a Google Calendar feed as an agenda, a week and a month", async ({
  loam,
}) => {
  const { window } = loam;
  const fetches = await loam.answerFetches({
    [CALENDAR_URL]: readFileSync(join(import.meta.dirname, "fixtures", "calendar.ics"), "utf8"),
  });
  const settings = await turnOn(window, "Google Calendar");
  await expect(settings.getByTestId("plugin-status-google-calendar")).toHaveText("Running");
  const address = settings.getByRole("textbox", { name: "Secret iCal addresses" });
  await address.fill(CALENDAR_URL);
  await address.press("Tab");
  await expect
    .poll(
      () =>
        JSON.parse(readFileSync(join(loam.dataDirectory, "plugins.json"), "utf8")).plugins[
          "google-calendar"
        ].settings.urls,
    )
    .toBe(CALENDAR_URL);
  await backToNotes(window);

  const pane = window.getByRole("region", { name: "Calendar" });
  const standup = pane.getByRole("button", { name: /^Daily standup/ });
  // The new setting restarts the plugin, closing a pane the old one opened, so open it again
  // until the restarted one shows the feed.
  await expect(async () => {
    if (!(await pane.isVisible()))
      await sidebar(window).getByRole("button", { name: "Calendar" }).click();
    await expect(standup.first()).toBeVisible({ timeout: 2_000 });
  }).toPass();
  // Today and each of the next two weeks.
  await expect(standup).toHaveCount(15);
  await standup.first().click();
  await expect(pane.getByText("Room 4", { exact: true })).toBeVisible();
  await expect(pane.getByText("Bring your updates, please.")).toBeVisible();
  await expect(pane.getByRole("link", { name: "https://example.com/standup-notes" })).toBeVisible();

  await pane.getByRole("combobox", { name: "View" }).click();
  await window.getByRole("option", { name: "Week" }).click();
  await expect(standup).toHaveCount(7);
  await pane.getByRole("button", { name: "Next" }).click();
  await expect(standup).toHaveCount(7);

  await pane.getByRole("combobox", { name: "View" }).click();
  await window.getByRole("option", { name: "Month" }).click();
  await pane.getByRole("button", { name: "Today" }).click();
  const thisMonth = new Date().toLocaleDateString([], { month: "long", year: "numeric" });
  await expect(pane.getByText(thisMonth, { exact: true })).toBeVisible();
  await expect(standup).toHaveCount(1);
  await pane.getByRole("button", { name: "Next" }).click();
  await expect(pane.getByText(thisMonth, { exact: true })).toBeHidden();
  await pane.getByRole("button", { name: "Today" }).click();
  await expect(pane.getByText(thisMonth, { exact: true })).toBeVisible();

  const before = (await fetches())[CALENDAR_URL]!;
  await pane.getByRole("button", { name: "Refresh" }).click();
  await expect.poll(async () => (await fetches())[CALENDAR_URL]).toBe(before + 1);

  await createNote(window, { title: "Plan", body: "Today:" });
  await appendToBody(window, "");
  await window.keyboard.press("Enter");
  await window.keyboard.type("/agenda");
  await expect(
    window.locator("#bn-suggestion-menu").getByRole("option", { name: /Today's agenda/ }),
  ).toBeVisible();
  await window.keyboard.press("Enter");
  await expectSaved(window, "Plan", "Daily standup (Room 4)");
});

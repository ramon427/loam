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

test("the built-in calendar shows a Google Calendar feed read-only by week, agenda and month", async ({
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

  const view = window.getByRole("region", { name: "Calendar" }).first();
  const standup = view.getByRole("button", { name: /^Daily standup,/ });
  // The new setting restarts the plugin, closing a view the old one opened, so open it again
  // until the restarted one shows the feed.
  await expect(async () => {
    if (!(await view.isVisible()))
      await sidebar(window).getByRole("button", { name: "Calendar" }).click();
    await expect(standup.first()).toBeVisible({ timeout: 2_000 });
  }).toPass();
  // A week of daily standups, which can't be changed without signing in.
  await expect(standup).toHaveCount(7);
  await expect(standup.first()).toHaveAttribute("data-readonly", "true");
  await standup.first().click();
  const popover = view.getByRole("dialog", { name: "Event" });
  await expect(popover.getByText("Room 4", { exact: true })).toBeVisible();
  await expect(popover.getByText("Bring your updates, please.")).toBeVisible();
  await expect(popover.getByRole("button", { name: "Edit event" })).toHaveCount(0);

  await view.getByRole("button", { name: "Next week" }).click();
  await expect(standup).toHaveCount(7);
  await view.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(standup).toHaveCount(14);

  await view.getByRole("button", { name: "Month", exact: true }).click();
  await view.getByRole("button", { name: "Today", exact: true }).click();
  const thisMonth = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  await expect(view.getByRole("heading", { name: thisMonth })).toBeVisible();
  await view.getByRole("button", { name: "Next month" }).first().click();
  await expect(view.getByRole("heading", { name: thisMonth })).toBeHidden();
  await view.getByRole("button", { name: "Today", exact: true }).click();
  await expect(view.getByRole("heading", { name: thisMonth })).toBeVisible();

  const before = (await fetches())[CALENDAR_URL]!;
  await view.getByRole("button", { name: "Refresh" }).click();
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

test("the built-in todo list adds, checks off, edits and deletes todos, and keeps them", async ({
  loam,
}) => {
  const { window } = loam;
  await turnOn(window, "Todos");
  await backToNotes(window);

  await sidebar(window).getByRole("button", { name: "Todos" }).click();
  const pane = () => loam.window.getByRole("region", { name: "Todos" });
  const add = pane().getByRole("textbox", { name: "New todo", exact: true });
  await add.fill("Buy milk");
  await add.press("Enter");
  await expect(pane().getByRole("checkbox", { name: "Buy milk" })).toBeVisible();
  await expect(add).toHaveValue("");
  await pane().getByLabel("Due date for the new todo").fill("2030-01-02");
  await add.fill("File taxes");
  await add.press("Enter");
  await expect(pane().getByRole("checkbox", { name: "File taxes" })).toBeVisible();

  await pane().getByRole("checkbox", { name: "Buy milk" }).click();
  await expect(pane().getByRole("button", { name: "Done (1)" })).toBeVisible();
  await expect(pane().getByRole("checkbox", { name: "Buy milk" })).toBeHidden();
  await pane().getByRole("button", { name: "Done (1)" }).click();
  await expect(pane().getByRole("checkbox", { name: "Buy milk" })).toBeChecked();

  await pane().getByRole("button", { name: "Edit File taxes" }).click();
  const text = pane().getByRole("textbox", { name: "Todo", exact: true });
  await text.fill("File the taxes");
  await pane().getByRole("button", { name: "Save" }).click();
  await expect(pane().getByRole("checkbox", { name: "File the taxes" })).toBeVisible();

  await window.keyboard.press("ControlOrMeta+Shift+P");
  const palette = window.getByRole("dialog", { name: "Commands" });
  await palette.getByRole("combobox", { name: "Search commands" }).fill("Add todo");
  await window.keyboard.press("Enter");
  const question = window.getByRole("dialog", { name: "Add todo" });
  await question.getByRole("textbox", { name: "Add todo" }).fill("Call Sam");
  await window.keyboard.press("Enter");
  await expect(question).toBeHidden();
  await expect(pane().getByRole("checkbox", { name: "Call Sam" })).toBeVisible();

  await expect
    .poll(() => {
      try {
        const saved = JSON.parse(
          readFileSync(join(loam.dataDirectory, "plugin-data", "todos.json"), "utf8"),
        );
        return saved.todos.map((todo: { text: string; done: boolean; due: string | null }) => [
          todo.text,
          todo.done,
          todo.due,
        ]);
      } catch {
        return null;
      }
    })
    .toEqual([
      ["Buy milk", true, null],
      ["File the taxes", false, "2030-01-02"],
      ["Call Sam", false, null],
    ]);

  await createNote(window, { title: "Today", body: "To do:" });
  await appendToBody(window, "");
  await window.keyboard.press("Enter");
  await window.keyboard.type("/todos");
  await expect(
    window.locator("#bn-suggestion-menu").getByRole("option", { name: /Open todos/ }),
  ).toBeVisible();
  await window.keyboard.press("Enter");
  await expectSaved(window, "Today", "File the taxes (due 2030-01-02)");
  await expectSaved(window, "Today", "Call Sam");

  await pane().getByRole("button", { name: "Delete Call Sam" }).click();
  await expect(pane().getByRole("checkbox", { name: "Call Sam" })).toBeHidden();
  await pane().getByRole("button", { name: "Clear done" }).click();
  await expect(pane().getByRole("button", { name: /^Done/ })).toBeHidden();

  await loam.restart();
  await sidebar(loam.window).getByRole("button", { name: "Todos" }).click();
  await expect(pane().getByRole("checkbox", { name: "File the taxes" })).toBeVisible();
  await expect(pane().getByRole("checkbox", { name: "Buy milk" })).toBeHidden();
});

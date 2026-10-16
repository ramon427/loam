import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

import { expect, LoamApp, test } from "../app";
import {
  appendToBody,
  createNote,
  expectSaved,
  noteBody,
  noteRow,
  openNote,
  openSettings,
  storedLibrary,
} from "../notes";
import { seedLibrary } from "./library";
import { Meter } from "./meter";
import { openResult, search } from "./search";

/** The unhappy and edge states a person meets: first launch, scale, sync trouble, time away. */

/** Buttons and fields a person can see, as a measure of how much the screen asks of them. */
const visibleControls = (window: Page) =>
  window.evaluate(
    () =>
      Array.from(
        document.querySelectorAll("button, input, [role=button], [role=searchbox]"),
      ).filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && !element.closest("[hidden],[inert]");
      }).length,
  );

test("state: first launch to a first saved note", async ({ loam }) => {
  const window = loam.window;
  const meter = new Meter(window, "states", "first launch to first note", 0.02);
  meter.observe(`controls on screen: ${await visibleControls(window)}`);
  meter.observe(
    `"New note" buttons on screen: ${await window.getByRole("button", { name: "New note", exact: true }).count()}`,
  );
  meter.decide(
    "Three New note buttons, a filter, a project and a folder button: where do I start?",
  );
  await meter.click(window.getByRole("main").getByRole("button", { name: "New note" }), "New note");
  meter.decide("What do I call this before I've written it?");
  await meter.type("First thoughts", "title");
  await meter.click(noteBody(window), "click into the body", { mouseOnly: true });
  await meter.type("Trying this out.", "body");
  await meter.check(() => expectSaved(window, "First thoughts", "Trying this out."));
  meter.observe(`controls on screen with a note open: ${await visibleControls(window)}`);
  meter.finish();
});

test("state: cold start with 2,000 notes", async ({ loam }) => {
  await seedLibrary(loam.window, 2000);
  await openNote(loam.window, "Budget: roof 0");
  await loam.quit();
  const meter = new Meter(null, "states", "cold start, 2,000 notes, to typing", 7);
  await meter.launch(() => loam.start());
  const window = loam.window;
  meter.attach(window);
  await meter.waitFor("last note shown", () =>
    expect(window.getByRole("main").getByRole("heading", { name: "Budget: roof 0" })).toBeVisible(),
  );
  // The last note reopens, but nothing has focus: typing goes nowhere until a click.
  meter.observe(
    `focus after start: ${await window.evaluate(() => document.activeElement?.tagName)}`,
  );
  await meter.click(noteBody(window).locator(".bn-block-content").last(), "click into the body", {
    mouseOnly: true,
  });
  await meter.press("ControlOrMeta+End", "end of the note");
  await meter.type(" More.", "body");
  await meter.check(() => expectSaved(window, "Budget: roof 0", "More."));
  meter.finish();
});

test("state: back after a week with three notes on the go", async ({ loam }) => {
  await seedLibrary(loam.window, 2000);
  for (const title of ["Interview: podcast 0", "Meeting: launch 1", "Budget: roof 0"])
    await openNote(loam.window, title);
  await loam.quit();
  await loam.start();
  await loam.advanceClock(7 * 24 * 60 * 60 * 1000);
  const window = loam.window;
  const meter = new Meter(window, "states", "back after a week: reopen the other two notes", 1);
  meter.decide("What was I working on besides this one?");
  // Only the last note reopens; there's no recent list, so each other note is a search.
  for (const [query, title] of [
    ["meeting launch 1", "Meeting: launch 1"],
    ["interview podcast 0", "Interview: podcast 0"],
  ] as const) {
    await search(meter, window, query);
    await openResult(meter, window, title);
  }
  meter.finish();
});

/** Picks `folder` in Settings › Sync and waits for the first sync. */
async function turnOnSync(app: LoamApp, folder: string) {
  await app.answerFilePickers([folder]);
  const settings = await openSettings(app.window, "Sync");
  await settings.getByRole("button", { name: /Choose folder|Change folder/ }).click();
  await expect(settings.getByTestId("settings-sync-state")).toHaveText(/^Synced/);
  await app.window.keyboard.press("Escape");
}

async function syncNow(app: LoamApp) {
  const settings = await openSettings(app.window, "Sync");
  await settings.getByRole("button", { name: "Sync now" }).click();
  await expect(settings.getByTestId("settings-sync-state")).toHaveText(/^Synced [^·]*$/);
  await app.window.keyboard.press("Escape");
}

test("state: resolve a sync conflict", async ({ loam }) => {
  const shared = join(loam.root, "Dropbox");
  mkdirSync(shared);
  const two = new LoamApp();
  try {
    await two.start();
    await turnOnSync(loam, shared);
    await createNote(loam.window, { title: "Shopping", body: "Milk" });
    await syncNow(loam);
    await turnOnSync(two, shared);
    await openNote(two.window, "Shopping");
    const settings = await openSettings(two.window, "Sync");
    await settings.getByRole("button", { name: "Turn off sync" }).click();
    await two.window.keyboard.press("Escape");
    await appendToBody(loam.window, ", bread");
    await expectSaved(loam.window, "Shopping", "bread");
    await syncNow(loam);
    await appendToBody(two.window, ", butter");
    await expectSaved(two.window, "Shopping", "butter");
    await turnOnSync(two, shared);

    // The person on the second computer now has two notes and wants one with both edits.
    const window = two.window;
    const meter = new Meter(window, "states", "resolve a sync conflict by hand", 0.1);
    const toast = window.getByText("Edited in two places at once");
    await meter.waitFor("conflict shows", () => expect(toast).toBeVisible());
    meter.observe(
      `a copy note was made: ${await noteRow(window, "Shopping (conflict copy)").isVisible()}`,
    );
    // The other edit is in the note's history; Compare opens it there.
    await meter.click(window.getByRole("button", { name: "Compare" }), "Compare");
    const history = window.getByRole("dialog", { name: "Version history" });
    await meter.waitFor("the other edit", () => expect(history).toContainText(/bread|butter/));
    const current = await noteBody(window).innerText();
    const missing = current.includes("butter") ? ", bread" : ", butter";
    meter.decide("What does the other edit have that this one doesn't?");
    await meter.press("Escape", "close history");
    await meter.click(
      noteBody(window).locator(".bn-block-content").last(),
      "click the end of the note",
      { mouseOnly: true },
    );
    await meter.press("ControlOrMeta+End", "end");
    await meter.type(missing, "add the missing edit");
    await meter.check(async () => {
      await expectSaved(window, "Shopping", "bread");
      await expectSaved(window, "Shopping", "butter");
      expect((await storedLibrary(window)).notes.map((note) => note.title)).toEqual(["Shopping"]);
    });
    meter.finish();
  } finally {
    await two.dispose();
  }
});

test("state: is my work synced? (sync folder gone)", async ({ loam }) => {
  const shared = join(loam.root, "Dropbox");
  mkdirSync(shared);
  await turnOnSync(loam, shared);
  await createNote(loam.window, { title: "Shopping", body: "Milk" });
  await syncNow(loam);
  // The cloud drive is unmounted, as when offline or signed out.
  renameSync(shared, `${shared}-gone`);
  await appendToBody(loam.window, ", eggs");
  await expectSaved(loam.window, "Shopping", "eggs");
  // Sync tries a few seconds after a change; the person looks later than that.
  await loam.window.waitForTimeout(15_000);
  const window = loam.window;
  const meter = new Meter(window, "states", "check sync health, folder unreachable", 0.5);
  meter.observe(
    `any sync word in the main window: ${await window.locator(".loam-shell").getByText(/sync/i).count()}`,
  );
  meter.decide("Is this synced? Nothing in the window says.");
  await meter.press("ControlOrMeta+,", "settings");
  await meter.click(
    window
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "Sync", exact: true }),
    "Sync",
    { mouseOnly: true },
  );
  const state = window.getByTestId("settings-sync-state");
  await meter.waitFor("sync state", () => expect(state).toBeVisible());
  meter.observe(`sync state reads: ${await state.innerText()}`);
  // A missing folder is made again, empty, so the app syncs into a local stand-in.
  meter.observe(`the missing sync folder was recreated: ${existsSync(shared)}`);
  meter.decide("Is that bad? What do I do about it?");
  meter.finish();
});

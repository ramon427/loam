import type { Page } from "@playwright/test";

import { expect, test } from "../app";
import { expectSaved, noteBody, noteRow, openNote, sidebar } from "../notes";
import { NEEDLE, seedLibrary } from "./library";
import { Meter } from "./meter";
import { openResult, search } from "./search";

/**
 * Job: capture a thought. Several times a day. The fastest path a person has today, with the
 * app already open, after a cold start, into a chosen folder, and onto the end of a running
 * note.
 */

const titleField = (window: Page) =>
  window.getByRole("main").getByRole("heading", { level: 1 }).getByRole("textbox");

test("capture: a new note while the app is open", async ({ loam }) => {
  const window = loam.window;
  await seedLibrary(window, 200);
  await openNote(window, "Budget: roof 0");
  const meter = new Meter(window, "capture", "new note, app open", 15);
  await meter.press("ControlOrMeta+n", "new note");
  await meter.waitFor("title field focused", () => expect(titleField(window)).toBeFocused());
  meter.decide("What do I call this before I've written it?");
  await meter.type("Call plumber", "title");
  // No key moves from the title into the body: Enter drops focus, Tab lands on a button.
  await meter.click(noteBody(window), "click into the body", { mouseOnly: true });
  await meter.type("Ask about the copper joint and Friday slot.", "body");
  await meter.check(() => expectSaved(window, "Call plumber", "copper joint"));
  // Where did it go? A person glances at the sidebar for the new note.
  meter.observe(
    `new note visible in the sidebar: ${await noteRow(window, "Call plumber").isVisible()}`,
  );
  meter.finish();
});

test("capture: from a closed app", async ({ loam }) => {
  await seedLibrary(loam.window, 200);
  await loam.quit();
  const meter = new Meter(null, "capture", "new note, app closed", 5);
  // Starting the app is one click on its icon, then a wait until it can take input.
  meter.decide("Is it worth opening the notes app for this?");
  await meter.launch(() => loam.start());
  const window = loam.window;
  meter.attach(window);
  await meter.press("ControlOrMeta+n", "new note");
  await meter.waitFor("title field focused", () => expect(titleField(window)).toBeFocused());
  meter.decide("What do I call this before I've written it?");
  await meter.type("Call plumber", "title");
  await meter.click(noteBody(window), "click into the body", { mouseOnly: true });
  await meter.type("Ask about the copper joint.", "body");
  await meter.check(() => expectSaved(window, "Call plumber", "copper joint"));
  meter.finish();
});

test("capture: a new note in a chosen folder", async ({ loam }) => {
  const window = loam.window;
  await seedLibrary(window, 2000);
  const meter = new Meter(window, "capture", "new note in folder (2,000 notes)", 3);
  meter.decide("Which folder does this belong in?");
  // Ctrl+N puts the note at the top level; a folder's own New note is on its right-click menu.
  const folder = noteRow(window, "Work");
  await meter.scrollTo(
    sidebar(window).getByRole("navigation", { name: "Notes" }),
    folder,
    "find the Work folder",
  );
  await meter.click(folder, "open the folder's menu", { button: "right", mouseOnly: true });
  await meter.click(window.getByRole("menuitem", { name: "New note", exact: true }), "New note", {
    mouseOnly: true,
  });
  await meter.waitFor("title field focused", () => expect(titleField(window)).toBeFocused());
  meter.decide("What do I call this before I've written it?");
  await meter.type("Pricing idea", "title");
  await meter.click(noteBody(window), "click into the body", { mouseOnly: true });
  await meter.type("Tiered by seats.", "body");
  await meter.check(() => expectSaved(window, "Pricing idea", "Tiered by seats"));
  meter.finish();
});

test("capture: append to a running note", async ({ loam }) => {
  const window = loam.window;
  await seedLibrary(window, 2000);
  const meter = new Meter(window, "capture", "append to running note (2,000 notes)", 5);
  await search(meter, window, "plumber quote");
  await openResult(meter, window, NEEDLE.title);
  // Opening from search leaves the find bar focused, not the body.
  await meter.press("Escape", "close the find bar");
  await meter.click(noteBody(window).locator(".bn-block-content").last(), "click the last line", {
    mouseOnly: true,
  });
  await meter.press("ControlOrMeta+End", "go to the end");
  await meter.press("Enter", "new line");
  await meter.type("Second quote: 380.", "body");
  await meter.check(() => expectSaved(window, NEEDLE.title, "Second quote: 380."));
  meter.finish();
});

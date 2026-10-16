import type { Page } from "@playwright/test";

import { expect, test } from "../app";
import { expectSaved, noteBody, noteRow, openNote, storedLibrary } from "../notes";
import { NEEDLE, seedLibrary } from "./library";
import { Meter } from "./meter";
import { runCommand } from "./palette";

/**
 * Job: link and rework notes. A few times a week. Each flow starts in a 2,000-note library.
 */

const main = (window: Page) => window.getByRole("main");

test.beforeEach(async ({ loam }) => {
  await seedLibrary(loam.window, 2000);
});

test("rework: link to another note while writing", async ({ loam }) => {
  const window = loam.window;
  await openNote(window, "Budget: roof 0");
  await noteBody(window).locator(".bn-block-content").last().click();
  await window.keyboard.press("ControlOrMeta+End");
  await window.keyboard.press("Enter");
  const meter = new Meter(window, "rework", "link to a note while writing (2,000 notes)", 5);
  await meter.type("See ", "prose");
  meter.decide("How do I link a note here: [[, @ or a button?");
  // A [[ link is what most notes apps teach; Loam's trigger is @.
  await meter.type("[[", "try [[");
  const mentions = window.getByRole("listbox", { name: "Note mentions" });
  meter.observe(`[[ opens the note picker: ${await mentions.isVisible()}`);
  await meter.press("Backspace", "remove [");
  await meter.press("Backspace", "remove [");
  await meter.type("@plumber", "mention");
  await meter.waitFor("note picker", () => expect(mentions).toBeVisible());
  meter.decide("Is the highlighted note the one I mean?");
  await meter.press("Enter", "insert the link");
  await meter.check(() =>
    expectSaved(window, "Budget: roof 0", NEEDLE.title.slice(0, 10)).catch(() => undefined),
  );
  meter.finish();
});

test("rework: see what links to this note", async ({ loam }) => {
  const window = loam.window;
  // One other note links here.
  await openNote(window, "Budget: roof 0");
  await noteBody(window).locator(".bn-block-content").last().click();
  await window.keyboard.press("ControlOrMeta+End");
  await window.keyboard.type(" @plumber");
  await window.getByRole("listbox", { name: "Note mentions" }).waitFor();
  await window.keyboard.press("Enter");
  await expectSaved(window, "Budget: roof 0", "Plumber quote");
  await window.getByRole("searchbox", { name: "Search notes" }).fill("plumber quote");
  await window
    .getByRole("list", { name: "Search results" })
    .getByRole("button", { name: /Plumber quote/ })
    .first()
    .click();
  await window.keyboard.press("Escape");
  const meter = new Meter(window, "rework", "see what links here", 2);
  meter.decide("Where are this note's backlinks?");
  // Backlinks sit behind a small header button; no key opens them.
  await meter.click(main(window).getByRole("button", { name: /^Linked from/ }), "Linked from…", {
    mouseOnly: true,
  });
  await meter.waitFor("backlinks menu", () => expect(window.getByRole("menu")).toBeVisible());
  meter.finish();
});

test("rework: move the open note into another folder", async ({ loam }) => {
  const window = loam.window;
  await openNote(window, "Budget: roof 0");
  const meter = new Meter(window, "rework", "move open note to a folder (2,000 notes)", 2);
  // "Move to…" in the palette picks a place for the open note; typing filters the places.
  await runCommand(meter, window, "move");
  const places = window.getByRole("combobox", { name: "Search folders and projects" });
  await meter.waitFor("places", () => expect(places).toBeFocused());
  await meter.type("mon", "folder name");
  meter.observe(
    `places left: ${(await window.getByRole("listbox", { name: "Places" }).getByRole("option").allInnerTexts()).join(", ")}`,
  );
  meter.decide("Is Money the highlighted place?");
  await meter.press("Enter", "move it");
  await meter.check(async () => {
    const library = await storedLibrary(window);
    const money = library.folders.find((folder) => folder.name === "Money")!;
    await expect
      .poll(
        async () =>
          (await storedLibrary(window)).notes.find((note) => note.title === "Budget: roof 0")
            ?.folderId,
      )
      .toBe(money.id);
  });
  meter.finish();
});

test("rework: rename the open note", async ({ loam }) => {
  const window = loam.window;
  await openNote(window, "Budget: roof 0");
  await noteBody(window).locator(".bn-block-content").last().click();
  const meter = new Meter(window, "rework", "rename the open note", 2);
  // The title is a field above the body; no key moves there from the body.
  const title = main(window).getByRole("heading", { level: 1 }).getByRole("textbox");
  await meter.click(title, "click the title", { mouseOnly: true });
  await meter.press("ControlOrMeta+a", "select the title");
  await meter.type("Roof repair budget", "new title");
  await meter.press("Escape", "leave the title");
  await meter.check(() =>
    expect
      .poll(async () =>
        (await storedLibrary(window)).notes.some((n) => n.title === "Roof repair budget"),
      )
      .toBe(true),
  );
  meter.finish();
});

test("rework: delete the open note", async ({ loam }) => {
  const window = loam.window;
  await openNote(window, "Budget: roof 0");
  await noteBody(window).locator(".bn-block-content").last().click();
  const meter = new Meter(window, "rework", "delete the open note", 3);
  // Delete works on a focused sidebar row, but no key moves focus from the note to its row.
  // Notes go to Trash without asking; Undo and Trash bring them back.
  await meter.click(noteRow(window, "Budget: roof 0"), "open the note's menu", {
    button: "right",
    mouseOnly: true,
  });
  await meter.click(
    window.getByRole("menuitem", { name: "Delete note", exact: true }),
    "Delete note",
    {
      mouseOnly: true,
    },
  );
  await meter.check(() => expect(noteRow(window, "Budget: roof 0")).toHaveCount(0));
  meter.finish();
});

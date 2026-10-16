import { expect, test } from "../app";
import {
  appendToBody,
  expectSaved,
  noteBody,
  noteRow,
  openNote,
  storedLibrary,
  storedText,
} from "../notes";
import { seedLibrary } from "./library";
import { Meter } from "./meter";

/**
 * Job: recover from a mistake. A few times a month: a note deleted by accident just now, one
 * deleted last week, and a paragraph overwritten some time ago.
 */

const titles = async (window: import("@playwright/test").Page) =>
  (await storedLibrary(window)).notes.map((note) => note.title);

async function deleteFromSidebar(window: import("@playwright/test").Page, title: string) {
  await noteRow(window, title).click({ button: "right" });
  await window.getByRole("menuitem", { name: "Delete note", exact: true }).click();
  await expect(noteRow(window, title)).toHaveCount(0);
}

test.beforeEach(async ({ loam }) => {
  await seedLibrary(loam.window, 200);
});

test("recover: undo a delete straight away", async ({ loam }) => {
  const window = loam.window;
  await openNote(window, "Budget: roof 0");
  await deleteFromSidebar(window, "Budget: roof 0");
  const meter = new Meter(window, "recover", "undo a delete straight away", 0.25);
  meter.decide("Oops: how do I get that back?");
  // Ctrl+Z is the reflex. It only undoes the delete while the sidebar has focus.
  await meter.press("ControlOrMeta+z", "undo");
  await window.waitForTimeout(500);
  const back = (await titles(window)).includes("Budget: roof 0");
  meter.observe(`Ctrl+Z right after the delete brings it back: ${back}`);
  meter.observe(
    `focus after the delete: ${await window.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName)}`,
  );
  if (!back) {
    const undo = window.getByRole("button", { name: "Undo", exact: true });
    if (await undo.isVisible()) {
      await meter.click(undo, "the toast's Undo");
    } else {
      meter.decide("The toast is gone: is it in Trash?");
      await meter.click(window.getByRole("button", { name: "Trash", exact: true }), "Trash", {
        mouseOnly: true,
      });
      await meter.click(
        window
          .getByRole("dialog", { name: "Trash" })
          .getByRole("group", { name: "Budget: roof 0" })
          .getByRole("button", { name: "Restore" }),
        "Restore",
        { mouseOnly: true },
      );
    }
  }
  await meter.check(() => expect.poll(() => titles(window)).toContain("Budget: roof 0"));
  meter.finish();
});

test("recover: restore a note deleted last week", async ({ loam }) => {
  const window = loam.window;
  for (const title of ["Budget: roof 0", "Interview: podcast 0", "Meeting: launch 1"])
    await deleteFromSidebar(window, title);
  await loam.restart();
  const meter = new Meter(loam.window, "recover", "restore a note deleted last week", 0.1);
  meter.decide("Where do deleted notes go?");
  await meter.click(loam.window.getByRole("button", { name: "Trash", exact: true }), "Trash", {
    mouseOnly: true,
  });
  const trash = loam.window.getByRole("dialog", { name: "Trash", exact: true });
  meter.decide("Which of these is the one I want?");
  await meter.click(
    trash
      .getByRole("group", { name: "Interview: podcast 0", exact: true })
      .getByRole("button", { name: "Restore", exact: true }),
    "Restore",
  );
  await meter.check(() => expect.poll(() => titles(loam.window)).toContain("Interview: podcast 0"));
  meter.observe(
    `restored note opens: ${await loam.window.getByRole("main").getByRole("heading", { name: "Interview: podcast 0" }).isVisible()}`,
  );
  meter.finish();
});

test("recover: bring back an overwritten paragraph", async ({ loam }) => {
  const window = loam.window;
  await openNote(window, "Budget: roof 0");
  await appendToBody(window, " Original estimate 9,000.");
  await expectSaved(window, "Budget: roof 0", "Original estimate 9,000.");
  await loam.advanceClock(11 * 60 * 1000);
  await noteBody(window).locator(".bn-block-content").first().click();
  await window.keyboard.press("ControlOrMeta+a");
  await window.keyboard.type("Rewritten.");
  await expectSaved(window, "Budget: roof 0", "Rewritten.");
  await loam.restart();
  const meter = new Meter(
    loam.window,
    "recover",
    "bring back overwritten text (after restart)",
    0.1,
  );
  // Undo history doesn't survive a restart, so the way back is version history.
  meter.decide("Where is this note's history?");
  await meter.click(noteRow(loam.window, "Budget: roof 0"), "open the note's menu", {
    button: "right",
    mouseOnly: true,
  });
  await meter.click(
    loam.window.getByRole("menuitem", { name: "Version history…" }),
    "Version history…",
    {
      mouseOnly: true,
    },
  );
  const dialog = loam.window.getByRole("dialog", { name: "Version history" });
  const versions = dialog.getByRole("list", { name: "Versions" }).getByRole("button");
  meter.observe(`versions listed: ${await versions.count()}`);
  meter.decide("Which version has the text I lost?");
  await meter.click(versions.first(), "a version");
  meter.decide("Is this the right one? Will restoring lose what I wrote since?");
  await meter.click(
    dialog.getByRole("button", { name: "Restore this version" }),
    "Restore this version",
  );
  await meter.check(() =>
    expect
      .poll(() => storedText(loam.window, "Budget: roof 0"))
      .toContain("Original estimate 9,000."),
  );
  meter.finish();
});

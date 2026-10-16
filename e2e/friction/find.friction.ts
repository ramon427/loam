import { expect, test } from "../app";
import { noteRow, sidebar } from "../notes";
import { NEEDLE, seedLibrary } from "./library";
import { Meter } from "./meter";
import { openResult, rankOf, results, search, searchBox } from "./search";

/**
 * Job: find an old note. Several times a day. Each flow starts in a 2,000-note library with
 * another note open, and ends with the wanted note on screen.
 */

test.beforeEach(async ({ loam }) => {
  await seedLibrary(loam.window, 2000);
  await noteRow(loam.window, "Budget: roof 0").click();
});

test("find: by a word in the title", async ({ loam }) => {
  const meter = new Meter(loam.window, "find", "by title word (2,000 notes)", 8);
  await search(meter, loam.window, "plumber");
  await openResult(meter, loam.window, NEEDLE.title);
  meter.finish();
});

test("find: by a phrase in the body", async ({ loam }) => {
  const meter = new Meter(loam.window, "find", "by body phrase (2,000 notes)", 3);
  await search(meter, loam.window, NEEDLE.phrase);
  await openResult(meter, loam.window, NEEDLE.title);
  meter.finish();
});

test("find: with a typo", async ({ loam }) => {
  const window = loam.window;
  const meter = new Meter(window, "find", "with a typo (2,000 notes)", 2);
  await meter.press("ControlOrMeta+Shift+f", "search");
  await meter.waitFor("search focused", () => expect(searchBox(window)).toBeFocused());
  await meter.type("plumer", "query with a typo");
  const answer = results(window).or(window.getByText(/No notes match/));
  await meter.waitFor("answer", () => expect(answer.first()).toBeVisible());
  const found = (await rankOf(window, NEEDLE.title)) > 0;
  meter.observe(`typo finds the note: ${found}`);
  if (!found) {
    meter.decide("Nothing matched: was it spelled differently, or is the note gone?");
    await search(meter, window, "plumber");
  }
  await openResult(meter, window, NEEDLE.title);
  meter.finish();
});

test("find: by browsing the folder it is in", async ({ loam }) => {
  const window = loam.window;
  const meter = new Meter(window, "find", "by browsing its folder (2,000 notes)", 2);
  meter.decide("Which folder did I put it in?");
  const tree = sidebar(window).getByRole("navigation", { name: "Notes" });
  const folder = noteRow(window, NEEDLE.folder);
  // Folders come after every loose note, so reaching one means scrolling past them.
  await meter.scrollTo(tree, folder, "find the folder");
  await meter.click(folder, "open the folder");
  meter.decide("Scan 80 similar-looking rows for the one I mean");
  await meter.scrollTo(tree, noteRow(window, NEEDLE.title), "scan the folder's notes");
  await meter.click(noteRow(window, NEEDLE.title), "open it");
  await meter.waitFor("note open", () =>
    expect(window.getByRole("main").getByRole("heading", { name: NEEDLE.title })).toBeVisible(),
  );
  meter.finish();
});

test("find: back to the note I was just in", async ({ loam }) => {
  const window = loam.window;
  // The person was in "Budget: roof 0", looked something up, and wants to go back.
  const lookup = new Meter(window, "find", "setup", 0);
  await search(lookup, window, "plumber");
  await openResult(lookup, window, NEEDLE.title);
  await window.keyboard.press("Escape");
  const meter = new Meter(window, "find", "back to the previous note (2,000 notes)", 10);
  await meter.press("Alt+ArrowLeft", "try Back");
  const wentBack = await window
    .getByRole("main")
    .getByRole("heading", { name: "Budget: roof 0" })
    .isVisible();
  meter.observe(`Alt+Left goes back: ${wentBack}`);
  // There is no back history or recent list, so the way back is another search.
  meter.decide("Back didn't work: what was that note called?");
  await search(meter, window, "budget roof");
  await openResult(meter, window, "Budget: roof 0");
  meter.finish();
});

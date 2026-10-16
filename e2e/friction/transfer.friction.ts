import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "../app";
import { noteRow, openNote, storedLibrary } from "../notes";
import { seedLibrary } from "./library";
import { Meter } from "./meter";
import { runCommand } from "./palette";

/**
 * Job: move content in and out. On the first day, then monthly at most: bring an old vault
 * in, send one note out, and get past an import that finds nothing.
 */

test("transfer: import a Markdown folder", async ({ loam }) => {
  const window = loam.window;
  await seedLibrary(window, 200);
  const vault = join(loam.root, "Old vault");
  mkdirSync(join(vault, "Projects"), { recursive: true });
  for (let index = 0; index < 20; index++)
    writeFileSync(
      join(vault, index % 2 ? "Projects" : "", `Imported ${index}.md`),
      `# Imported ${index}\n\nBody ${index}.\n`,
    );
  await loam.answerFilePickers([vault]);

  const meter = new Meter(window, "transfer", "import a Markdown folder", 0.02);
  meter.decide("Where is import: a menu, the sidebar, or settings?");
  // Import lives only in Settings › Import & export.
  await meter.press("ControlOrMeta+,", "settings");
  await meter.click(
    window
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "Import & export", exact: true }),
    "Import & export",
    { mouseOnly: true },
  );
  // One "Import…" takes any export; Loam tells which app's it is.
  await meter.click(window.getByRole("button", { name: "Import…", exact: true }), "Import…", {
    mouseOnly: true,
  });
  meter.decide("Pick the folder in the system dialog");
  const summary = window.getByRole("dialog", { name: "Import finished" });
  await meter.waitFor("import summary", () => expect(summary).toBeVisible());
  await meter.click(summary.getByRole("button", { name: "Done" }), "Done");
  await meter.click(window.getByRole("button", { name: /Back to notes/ }), "Back to notes");
  meter.decide("Where did the imported notes go?");
  meter.observe(`an imported note is in view: ${await noteRow(window, "Imported 0").isVisible()}`);
  meter.observe(`imported folder in view: ${await noteRow(window, "Projects").isVisible()}`);
  expect((await storedLibrary(window)).notes.some((note) => note.title === "Imported 0")).toBe(
    true,
  );
  meter.finish();
});

test("transfer: an import that finds nothing", async ({ loam }) => {
  const window = loam.window;
  const vault = join(loam.root, "Word docs");
  mkdirSync(vault);
  for (const name of ["Minutes.docx", "Plan.txt", "Notes.rtf"])
    writeFileSync(join(vault, name), "x");
  await loam.answerFilePickers([vault]);

  const meter = new Meter(window, "transfer", "import a folder with no notes in it", 0.01);
  await meter.press("ControlOrMeta+,", "settings");
  await meter.click(
    window
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "Import & export", exact: true }),
    "Import & export",
    { mouseOnly: true },
  );
  // One "Import…" takes any export; Loam tells which app's it is.
  await meter.click(window.getByRole("button", { name: "Import…", exact: true }), "Import…", {
    mouseOnly: true,
  });
  meter.decide("Pick the folder in the system dialog");
  const message = window.getByText(/Nothing to import|No notes were found/).first();
  await meter.waitFor("the app's answer", () => expect(message).toBeVisible());
  meter.observe(
    `message: ${(await window.getByRole("region", { name: /Notifications/ }).innerText()).replace(/\s+/g, " ").trim()}`,
  );
  meter.decide("Why not? Which file types does it take, and what do I do with my .docx?");
  meter.finish();
});

test("transfer: export one note as Markdown", async ({ loam }) => {
  const window = loam.window;
  await seedLibrary(window, 200);
  await openNote(window, "Budget: roof 0");
  const out = join(loam.root, "out");
  mkdirSync(out);
  await loam.answerFilePickers([out]);
  await window.evaluate(() => undefined);
  const meter = new Meter(window, "transfer", "export one note as Markdown", 0.25);
  // One "Export…" in the palette (and Settings) asks: this note or all notes.
  await runCommand(meter, window, "export");
  const choice = window
    .getByRole("dialog", { name: "Export as Markdown" })
    .getByRole("button", { name: /^This note/ });
  await meter.waitFor("export dialog", () => expect(choice).toBeFocused());
  meter.decide("This note or all of them?");
  await meter.press("Enter", "this note");
  meter.decide("Pick where to save it in the system dialog");
  await meter.waitFor("exported", () =>
    expect(window.getByText(/^Exported/).first()).toBeVisible(),
  );
  meter.observe(`files written: ${readdirSync(out, { recursive: true }).length}`);
  meter.finish();
});

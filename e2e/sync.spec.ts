import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, LoamApp, test } from "./app";
import {
  appendToBody,
  createNote,
  expectSaved,
  noteBody,
  noteRow,
  openNote,
  openSettings,
} from "./notes";

/** Picks `folder` in Settings › Sync and waits for the first sync. */
async function turnOnSync(app: LoamApp, folder: string) {
  await app.answerFilePickers([folder]);
  const settings = await openSettings(app.window, "Sync");
  await settings.getByRole("button", { name: /Choose folder|Change folder/ }).click();
  await expect(settings.getByTestId("settings-sync-folder")).toHaveText(folder);
  await expect(settings.getByTestId("settings-sync-state")).toHaveText(/^Synced/);
  await app.window.keyboard.press("Escape");
}

async function turnOffSync(app: LoamApp) {
  const settings = await openSettings(app.window, "Sync");
  await settings.getByRole("button", { name: "Turn off sync" }).click();
  await expect(settings.getByText("Off", { exact: true })).toBeVisible();
  await app.window.keyboard.press("Escape");
}

/** Clicks Sync now and waits until nothing is left to send. */
async function syncNow(app: LoamApp) {
  const settings = await openSettings(app.window, "Sync");
  await settings.getByRole("button", { name: "Sync now" }).click();
  await expect(settings.getByTestId("settings-sync-state")).toHaveText(/^Synced [^·]*$/);
  await app.window.keyboard.press("Escape");
}

test("syncs notes between two computers through a shared folder", async ({ loam }) => {
  const shared = join(loam.root, "Dropbox");
  mkdirSync(shared);
  const two = new LoamApp();
  try {
    await two.start();
    await turnOnSync(loam, shared);
    await createNote(loam.window, { title: "Shopping", body: "Milk" });
    await expectSaved(loam.window, "Shopping", "Milk");
    await syncNow(loam);

    // A second computer joins and gets the note.
    await turnOnSync(two, shared);
    await openNote(two.window, "Shopping");
    await expect(noteBody(two.window)).toContainText("Milk");

    // An edit there reaches the first computer's open note.
    await appendToBody(two.window, " and eggs");
    await expectSaved(two.window, "Shopping", "and eggs");
    await syncNow(two);
    await syncNow(loam);
    await expect(noteBody(loam.window)).toContainText("Milk and eggs");

    // Both edit while out of touch: nothing is lost.
    await turnOffSync(two);
    await appendToBody(loam.window, ", bread");
    await expectSaved(loam.window, "Shopping", "bread");
    await syncNow(loam);
    await appendToBody(two.window, ", butter");
    await expectSaved(two.window, "Shopping", "butter");
    await turnOnSync(two, shared);
    await syncNow(loam);

    for (const app of [loam, two])
      await expect(noteRow(app.window, "Shopping (conflict copy)")).toBeVisible();
    await expect(two.window.getByText("Edited in two places at once")).toBeVisible();
  } finally {
    await two.dispose();
  }
});

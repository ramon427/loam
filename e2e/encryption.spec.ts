import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { expect, LoamApp, test } from "./app";
import { createNote, expectSaved, noteBody, openNote, openSettings, sidebar } from "./notes";

const SECRET = "Tangerine";
const PASSPHRASE = "correct horse battery";

async function turnOnEncryption(loam: LoamApp) {
  const settings = await openSettings(loam.window, "Security");
  await settings.getByRole("button", { name: /Encrypt my notes/ }).click();
  const setup = loam.window.getByRole("dialog", { name: "Encrypt your notes" });
  await setup.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
  await setup.getByLabel("Passphrase again").fill(PASSPHRASE);
  await setup.getByRole("button", { name: "Continue" }).click();
  const save = loam.window.getByRole("dialog", { name: "Save your recovery key" });
  const recoveryKey = (await save.getByTestId("recovery-key").textContent())!;
  expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
  await expect(save.getByRole("button", { name: "Encrypt my notes" })).toBeDisabled();
  await save.getByRole("checkbox").click();
  await save.getByRole("button", { name: "Encrypt my notes" }).click();
  await expect(settings.getByTestId("settings-encryption-state")).toHaveText("On");
  await loam.window.keyboard.press("Escape");
  return recoveryKey;
}

/** Picks `folder` in Settings › Sync; returns the open Sync settings. */
async function chooseSyncFolder(loam: LoamApp, folder: string) {
  await loam.answerFilePickers([folder]);
  const settings = await openSettings(loam.window, "Sync");
  await settings.getByRole("button", { name: /Choose folder|Change folder/ }).click();
  await expect(settings.getByTestId("settings-sync-folder")).toHaveText(folder);
  return settings;
}

/** Whether any file in the data folder (backups unzipped) holds `text`. */
const dataFolderContains = (loam: LoamApp, text: string) =>
  readdirSync(loam.dataDirectory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .some((entry) => {
      const bytes = readFileSync(join(entry.parentPath, entry.name));
      return (entry.name.endsWith(".gz") ? gunzipSync(bytes) : bytes).includes(text);
    });

async function unlock(loam: LoamApp, passphrase: string) {
  const window = loam.window;
  await window.getByLabel("Passphrase").fill(passphrase);
  await window.getByRole("button", { name: "Unlock", exact: true }).click();
}

test("encrypts the notes, asks for the passphrase at launch, and resets it with the recovery key", async ({
  loam,
}) => {
  await createNote(loam.window, { title: `${SECRET} plans`, body: "Meet at noon" });
  await expectSaved(loam.window, `${SECRET} plans`, "Meet at noon");
  expect(dataFolderContains(loam, SECRET)).toBe(true);

  // Turn encryption on: passphrase twice, then the recovery key must be saved.
  const recoveryKey = await turnOnEncryption(loam);
  expect(dataFolderContains(loam, SECRET)).toBe(false);

  // Search and editing carry on while unlocked.
  await loam.window.getByRole("searchbox", { name: "Search notes" }).fill("tangerine noon");
  await expect(loam.window.getByRole("list", { name: "Search results" })).toContainText(
    `${SECRET} plans`,
  );
  await loam.window.getByRole("searchbox", { name: "Search notes" }).fill("");

  // Next launch: locked until the right passphrase.
  await loam.restart();
  await expect(loam.window.getByRole("heading", { name: "Your notes are locked" })).toBeVisible();
  await unlock(loam, "wrong passphrase");
  await expect(loam.window.getByRole("alert")).toHaveText("That passphrase isn't right.");
  await unlock(loam, PASSPHRASE);
  await openNote(loam.window, `${SECRET} plans`);
  await expect(noteBody(loam.window)).toContainText("Meet at noon");

  // Forgotten passphrase: the recovery key unlocks and sets a new one.
  await loam.restart();
  await loam.window.getByRole("button", { name: "Forgot your passphrase?" }).click();
  await loam.window.getByLabel("Recovery key").fill(recoveryKey.toLowerCase());
  await loam.window.getByLabel("New passphrase", { exact: true }).fill("a new passphrase");
  await loam.window.getByLabel("New passphrase again").fill("a new passphrase");
  await loam.window.getByRole("button", { name: "Unlock and save passphrase" }).click();
  await expect(noteRowVisible(loam)).toBeVisible();

  // Turn it off again: the next launch opens straight to the notes.
  const security = await openSettings(loam.window, "Security");
  await security.getByRole("button", { name: /Turn off encryption/ }).click();
  const off = loam.window.getByRole("dialog", { name: "Turn off encryption?" });
  await off.getByLabel("Passphrase").fill("a new passphrase");
  await off.getByRole("button", { name: "Turn off encryption" }).click();
  await expect(security.getByTestId("settings-encryption-state")).toHaveText("Off");
  await loam.restart();
  await expect(noteRowVisible(loam)).toBeVisible();
});

const noteRowVisible = (loam: LoamApp) => sidebar(loam.window).getByText(`${SECRET} plans`).first();

test("a second computer joins an encrypted sync folder with the passphrase", async ({ loam }) => {
  const shared = join(loam.root, "Dropbox");
  mkdirSync(shared);
  await createNote(loam.window, { title: `${SECRET} plans`, body: "Meet at noon" });
  await expectSaved(loam.window, `${SECRET} plans`, "Meet at noon");
  await turnOnEncryption(loam);
  const first = await chooseSyncFolder(loam, shared);
  await expect(first.getByTestId("settings-sync-state")).toHaveText(/^Synced/);
  await loam.window.keyboard.press("Escape");

  const two = new LoamApp();
  try {
    await two.start();
    const settings = await chooseSyncFolder(two, shared);
    await settings.getByLabel("Passphrase or recovery key").fill("wrong passphrase");
    await settings.getByRole("button", { name: /Unlock and sync/ }).click();
    await expect(settings.getByRole("alert").last()).toContainText("isn't right");
    await settings.getByLabel("Passphrase or recovery key").fill(PASSPHRASE);
    await settings.getByRole("button", { name: /Unlock and sync/ }).click();
    await expect(settings.getByTestId("settings-sync-state")).toHaveText(/^Synced/);
    await two.window.keyboard.press("Escape");
    await openNote(two.window, `${SECRET} plans`);
    await expect(noteBody(two.window)).toContainText("Meet at noon");
    expect(dataFolderContains(two, SECRET)).toBe(false);

    // It asks for the passphrase at launch too.
    await two.restart();
    await expect(two.window.getByRole("heading", { name: "Your notes are locked" })).toBeVisible();
    await unlock(two, PASSPHRASE);
    await expect(noteRowVisible(two)).toBeVisible();
  } finally {
    await two.dispose();
  }
});

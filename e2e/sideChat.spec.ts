import { expect, test } from "./app";
import { openSettings } from "./notes";

test("the side chat stays hidden until it is turned on, then opens and closes from the keyboard", async ({
  loam,
}) => {
  const { window } = loam;
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await expect(window.getByRole("button", { name: "Open side chat" })).toHaveCount(0);
  await window.keyboard.press(`${mod}+Shift+J`);
  await expect(window.getByRole("complementary", { name: "Side chat" })).toHaveCount(0);

  const settings = await openSettings(window, "Side chat");
  await settings.getByRole("button", { name: "Turn on side chat" }).click();
  await expect(settings.getByRole("button", { name: "Turn off side chat" })).toBeVisible();
  await window.keyboard.press("Escape");

  await window.keyboard.press(`${mod}+Shift+J`);
  const panel = window.getByRole("complementary", { name: "Side chat" });
  await expect(panel).toBeVisible();
  // No key saved yet: the panel points to Settings instead of a composer.
  await expect(panel.getByRole("button", { name: "Open Settings" })).toBeVisible();
  await window.keyboard.press(`${mod}+Shift+J`);
  await expect(panel).toBeHidden();
  await window.getByRole("button", { name: "Open side chat" }).click();
  await expect(panel).toBeVisible();
});

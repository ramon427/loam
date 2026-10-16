import { expect, type Page } from "@playwright/test";

import type { Meter } from "./meter";

/** Runs an app command by typing part of its name in the command palette. */
export async function runCommand(meter: Meter, window: Page, query: string) {
  await meter.press("ControlOrMeta+Shift+p", "command palette");
  const search = window.getByRole("combobox", { name: "Search commands" });
  await meter.waitFor("palette open", () => expect(search).toBeFocused());
  await meter.type(query, "command name");
  meter.decide("Is the highlighted command the one I mean?");
  await meter.press("Enter", "run it");
}

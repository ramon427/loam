import { expect, type Page } from "@playwright/test";

import type { Meter } from "./meter";

export const searchBox = (window: Page) => window.getByRole("searchbox", { name: "Search notes" });

export const results = (window: Page) => window.getByRole("list", { name: "Search results" });

const matches = (window: Page) => results(window).locator("[data-search-result]");

/** Where the note titled `title` ranks among the results shown, 1-based, or 0. */
export async function rankOf(window: Page, title: string) {
  const titles = (await matches(window).allInnerTexts()).map((text) => text.split("\n")[0]);
  return titles.indexOf(title) + 1;
}

/** Opens search with its shortcut and types `query` over whatever was there. */
export async function search(meter: Meter, window: Page, query: string) {
  await meter.press("ControlOrMeta+Shift+f", "search");
  await meter.waitFor("search focused", () => expect(searchBox(window)).toBeFocused());
  if (await searchBox(window).inputValue())
    await meter.press("ControlOrMeta+a", "select the old query");
  await meter.type(query, "query");
  await meter.waitFor("results", () => expect(matches(window).first()).toBeVisible());
}

/**
 * Picks the note titled `title` from the results as a person would: arrow keys when it is on
 * the first page, otherwise "Show more results" until it appears, then a click.
 */
export async function openResult(meter: Meter, window: Page, title: string) {
  meter.decide("Which of these results is the note I mean?");
  let rank = await rankOf(window, title);
  let pages = 0;
  while (!rank) {
    const more = results(window).getByRole("button", { name: "Show more results" });
    if (!(await more.isVisible())) throw new Error(`"${title}" is not in the results`);
    meter.decide("Not on this page: show more?");
    const shown = await matches(window).count();
    await meter.click(more, "Show more results");
    pages++;
    await meter.waitFor("more results", () => expect(matches(window)).not.toHaveCount(shown));
    rank = await rankOf(window, title);
  }
  meter.observe(`"${title}" ranks ${rank}${pages ? ` after ${pages} more pages` : ""}`);
  if (pages) {
    await meter.click(matches(window).nth(rank - 1), "open it");
  } else {
    for (let step = 0; step < rank; step++) await meter.press("ArrowDown", "move down");
    await meter.press("Enter", "open it");
  }
  await meter.waitFor("note open", () =>
    expect(window.getByRole("main").getByRole("heading", { name: title })).toBeVisible(),
  );
}

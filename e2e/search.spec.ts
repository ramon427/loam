import { expect, test } from "./app";
import { createNote, noteBody, sidebar } from "./notes";

const seedNotes = async (window: import("@playwright/test").Page, count: number) => {
  await window.evaluate(async (count) => {
    for (let index = 0; index < count; index++) {
      const tabId = crypto.randomUUID();
      const result = await globalThis.window.loam.invoke("notes.create", {
        note: {
          id: crypto.randomUUID(),
          title: `Search candidate ${String(index + 1).padStart(2, "0")}`,
          tabs: [{ id: tabId, title: "Notes", kind: "page" }],
          activeTabId: tabId,
          blocksByTab: {
            [tabId]: [
              {
                id: crypto.randomUUID(),
                type: "paragraph",
                props: {},
                content: [{ type: "text", text: "paginationmarker", styles: {} }],
                children: [],
              },
            ],
          },
        },
      });
      if (!result.ok) throw new Error(result.error.message);
    }
  }, count);
  await window.reload();
  await expect(window.getByRole("searchbox", { name: "Search notes" })).toBeVisible();
};

test("search opens the matching inactive tab, highlights it, and preserves the query", async ({
  loam,
}) => {
  const { window } = loam;
  await window.evaluate(async () => {
    const block = (text: string) => [
      {
        id: crypto.randomUUID(),
        type: "paragraph",
        props: {},
        content: [{ type: "text", text, styles: {} }],
        children: [],
      },
    ];
    await globalThis.window.loam.invoke("notes.create", {
      note: {
        id: crypto.randomUUID(),
        title: "Field guide",
        tabs: [
          { id: "overview", title: "Overview" },
          { id: "details", title: "Details" },
        ],
        activeTabId: "overview",
        blocksByTab: {
          overview: block("Overview without the match."),
          details: block("Deepuniquemarker lives in this second tab."),
        },
      },
    });
  });
  await window.reload();
  const search = window.getByRole("searchbox", { name: "Search notes" });
  await search.fill("Field deepuniquemarker");
  await window
    .getByRole("list", { name: "Search results" })
    .getByRole("button", { name: /Field guide/ })
    .click();
  await expect(noteBody(window)).toContainText("Deepuniquemarker");
  await expect(search).toHaveValue("Field deepuniquemarker");
  await expect(window.getByRole("search", { name: "Find in note" })).toContainText("1 of 1");
  await expect
    .poll(() =>
      window.evaluate(() =>
        Array.from(CSS.highlights.get("note-find-active") ?? []).map((range) => range.toString()),
      ),
    )
    .toEqual(["Deepuniquemarker"]);
  await window.getByRole("button", { name: "Close find" }).click();
  await loam.restart();
  await expect(
    loam.window.getByRole("main").getByRole("heading", { name: "Field guide" }),
  ).toBeVisible();
  await expect(noteBody(loam.window)).toContainText("Deepuniquemarker");
});

test("search pages past 50 matches and arrow keys open a chosen result", async ({ loam }) => {
  const { window } = loam;
  await seedNotes(window, 63);
  const search = window.getByRole("searchbox", { name: "Search notes" });
  await search.fill("paginationmarker");
  const list = window.getByRole("list", { name: "Search results" });
  const matches = list.locator("[data-search-result]");
  await expect(matches).toHaveCount(20);
  await list.getByRole("button", { name: "Show more results" }).click();
  await expect(matches).toHaveCount(40);
  await list.getByRole("button", { name: "Show more results" }).click();
  await expect(matches).toHaveCount(60);
  await list.getByRole("button", { name: "Show more results" }).click();
  await expect(matches).toHaveCount(63);
  await expect(list.getByRole("button", { name: "Show more results" })).toHaveCount(0);
  // Each result shows its note's title on the first line.
  const titles = (await matches.allInnerTexts()).map((text) => text.split("\n")[0]);
  expect(new Set(titles).size).toBe(63);
  const chosen = titles[1]!;
  await search.focus();
  await window.keyboard.press("ArrowDown");
  await window.keyboard.press("ArrowDown");
  await window.keyboard.press("Enter");
  await expect(
    window.getByRole("main").getByRole("heading", { name: chosen, exact: true }),
  ).toBeVisible();
  await expect(search).toHaveValue("paginationmarker");
  await window.getByRole("button", { name: "Close find" }).click();
  await window.getByRole("button", { name: "Collapse sidebar" }).click();
  await window.keyboard.press("ControlOrMeta+Shift+f");
  await expect(search).toBeFocused();
  await expect(list).toBeVisible();
  await window.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(search).toHaveValue("paginationmarker");
});

test("search lets go when the page or header is pressed elsewhere", async ({ loam }) => {
  const { window } = loam;
  await seedNotes(window, 1);
  const search = window.getByRole("searchbox", { name: "Search notes" });
  const list = window.getByRole("list", { name: "Search results" });
  await search.fill("paginationmarker");
  await expect(list).toBeVisible();
  await window.locator(".loam-main-header").click({ position: { x: 24, y: 20 } });
  await expect(list).toHaveCount(0);
  await expect(search).not.toBeFocused();
  await search.focus();
  await expect(list).toBeVisible();
  await window.locator("main").click({ position: { x: 40, y: 200 } });
  await expect(list).toHaveCount(0);
  await expect(search).not.toBeFocused();
  await search.focus();
  const tree = sidebar(window).getByRole("group", { name: "Notes tree selection area" });
  const box = (await tree.boundingBox())!;
  await window.mouse.click(box.x + box.width / 2, box.y + box.height - 8);
  await expect(list).toHaveCount(0);
  await expect(search).not.toBeFocused();
  await expect(search).toHaveValue("paginationmarker");
});

test("Find in note highlights matches and navigates with Enter and Shift+Enter", async ({
  loam,
}) => {
  const { window } = loam;
  await createNote(window, { title: "Find test", body: "Amber one, amber two, amber three." });
  await noteBody(window).click();
  await window.keyboard.press("ControlOrMeta+f");
  const find = window.getByRole("search", { name: "Find in note" });
  await expect(find.getByRole("searchbox", { name: "Find in note" })).toBeFocused();
  await find.getByRole("searchbox").fill("amber");
  await expect(find).toContainText("1 of 3");
  await window.keyboard.press("Enter");
  await expect(find).toContainText("2 of 3");
  await window.keyboard.press("Shift+Enter");
  await expect(find).toContainText("1 of 3");
  await find.getByRole("searchbox").fill("not present");
  await expect(find).toContainText("No matches");
  await window.keyboard.press("Escape");
  await expect(find).toHaveCount(0);
  expect(await window.evaluate(() => CSS.highlights.has("note-find"))).toBe(false);
});

import type { Page } from "@playwright/test";

import { expect, test } from "./app";
import { noteBody, openNote } from "./notes";

/** One of each block, nested where nesting changes the geometry. */
const blocks = [
  { key: "paragraph", type: "paragraph", content: "A paragraph" },
  { key: "heading 1", type: "heading", props: { level: 1 }, content: "Heading one" },
  { key: "heading 2", type: "heading", props: { level: 2 }, content: "Heading two" },
  { key: "heading 3", type: "heading", props: { level: 3 }, content: "Heading three" },
  {
    key: "toggle heading",
    type: "heading",
    props: { level: 2, isToggleable: true },
    content: "Toggle heading",
  },
  {
    key: "bullet",
    type: "bulletListItem",
    content: "A bullet",
    children: [{ key: "nested bullet", type: "bulletListItem", content: "A nested bullet" }],
  },
  { key: "numbered", type: "numberedListItem", content: "A numbered item" },
  { key: "check", type: "checkListItem", content: "A check item" },
  { key: "toggle", type: "toggleListItem", content: "A toggle" },
  { key: "quote", type: "quote", content: "A quote" },
  { key: "code", type: "codeBlock", content: "const code = 1;" },
  { key: "divider", type: "divider" },
  {
    key: "table",
    type: "table",
    content: { type: "tableContent", rows: [{ cells: ["A", "B"] }, { cells: ["C", "D"] }] },
  },
  { key: "empty image", type: "image" },
  { key: "last", type: "paragraph", content: "The end" },
] as const;

type SeedBlock = {
  key: string;
  type: string;
  props?: object;
  content?: unknown;
  children?: readonly SeedBlock[];
};

/** Stored blocks keyed by `data-id`, so each can be found by its key. */
const toStored = (block: SeedBlock): object => ({
  id: block.key.replaceAll(" ", "-"),
  type: block.type,
  props: block.props ?? {},
  content:
    typeof block.content === "string"
      ? [{ type: "text", text: block.content, styles: {} }]
      : block.content,
  children: (block.children ?? []).map(toStored),
});

const blockId = (key: string) => key.replaceAll(" ", "-");

async function openLayoutNote(window: Page) {
  await window.evaluate(async (stored) => {
    const tabId = crypto.randomUUID();
    const result = await globalThis.window.loam.invoke("notes.create", {
      note: {
        id: crypto.randomUUID(),
        title: "Layout",
        tabs: [{ id: tabId, title: "Notes", kind: "page" }],
        activeTabId: tabId,
        blocksByTab: { [tabId]: stored },
      },
    });
    if (!result.ok) throw new Error(result.error.message);
  }, blocks.map(toStored));
  await window.reload();
  await openNote(window, "Layout");
  await expect(noteBody(window).getByText("The end")).toBeVisible();
}

/** The vertical middle of a block's first line: of its text, its first code line, or its rule. */
const firstLineCenter = (window: Page, id: string) =>
  window.evaluate((id) => {
    const content = document.querySelector(
      `main .bn-block-outer[data-id="${id}"] > .bn-block > .bn-block-content`,
    )!;
    const lineHeight = (element: Element) => parseFloat(getComputedStyle(element).lineHeight);
    const code = content.querySelector("pre");
    if (code) {
      const top = code.getBoundingClientRect().top + parseFloat(getComputedStyle(code).paddingTop);
      return top + lineHeight(code) / 2;
    }
    const text = content.querySelector(".bn-inline-content");
    if (text) return text.getBoundingClientRect().top + lineHeight(text) / 2;
    const { top, height } = content.querySelector("hr")!.getBoundingClientRect();
    return top + height / 2;
  }, id);

/** Points at a block and waits for the side menu to move to it. */
async function hoverBlock(window: Page, id: string) {
  const block = noteBody(window).locator(`.bn-block-outer[data-id="${id}"] > .bn-block`);
  const content = block.locator("> .bn-block-content");
  const blockBox = (await block.boundingBox())!;
  const contentBox = (await content.boundingBox())!;
  await window.mouse.move(
    contentBox.x + contentBox.width / 2,
    contentBox.y + Math.min(contentBox.height / 2, 8),
  );
  const menu = window.locator(".bn-side-menu");
  await expect
    .poll(async () => {
      const top = await menu.evaluate((element) => element.getBoundingClientRect().top);
      return Math.abs(top - blockBox.y) < 1;
    })
    .toBe(true);
  return { content: contentBox, menu };
}

test("block controls and hover boxes line up with each block's first line", async ({ loam }) => {
  const { window } = loam;
  await loam.setWindowSize(1400, 950);
  await openLayoutNote(window);

  const gaps: number[] = [];
  for (const key of [
    "paragraph",
    "heading 1",
    "heading 2",
    "heading 3",
    "toggle heading",
    "bullet",
    "nested bullet",
    "numbered",
    "check",
    "toggle",
    "quote",
    "code",
    "divider",
  ]) {
    const id = blockId(key);
    const { content, menu } = await hoverBlock(window, id);
    const handle = (await menu.locator("button[draggable=true]").boundingBox())!;
    const lineCenter = await firstLineCenter(window, id);
    // The drag handle is centered on the first line, whatever the block's type.
    expect(Math.abs(handle.y + handle.height / 2 - lineCenter), key).toBeLessThanOrEqual(1.5);
    gaps.push(content.x - (handle.x + handle.width));
  }
  // ...and sits the same distance from every block.
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);

  // Inline controls share the marker column and center on the text line.
  const markers = await window.evaluate(() => {
    const centerY = (element: Element) => {
      const { top, height } = element.getBoundingClientRect();
      return top + height / 2;
    };
    const text = (id: string) =>
      document.querySelector(`main [data-id="${id}"] .bn-inline-content`)!;
    const lineCenter = (id: string) => {
      const line = text(id);
      return line.getBoundingClientRect().top + parseFloat(getComputedStyle(line).lineHeight) / 2;
    };
    const textLeft = (id: string) => text(id).getBoundingClientRect().left;
    const checkbox = document.querySelector("main [data-id='check'] input[type=checkbox]")!;
    const toggle = document.querySelector("main [data-id='toggle'] .bn-toggle-button")!;
    const toggleHeading = document.querySelector(
      "main [data-id='toggle-heading'] .bn-toggle-button",
    )!;
    return {
      checkboxOffset: centerY(checkbox) - lineCenter("check"),
      toggleOffset: centerY(toggle) - lineCenter("toggle"),
      toggleHeadingOffset: centerY(toggleHeading) - lineCenter("toggle-heading"),
      textIndents: ["bullet", "numbered", "check", "toggle"].map(
        (id) => textLeft(id) - textLeft("paragraph"),
      ),
    };
  });
  expect(Math.abs(markers.checkboxOffset)).toBeLessThanOrEqual(1);
  expect(Math.abs(markers.toggleOffset)).toBeLessThanOrEqual(1);
  expect(Math.abs(markers.toggleHeadingOffset)).toBeLessThanOrEqual(1);
  expect(new Set(markers.textIndents).size).toBe(1);

  // Hovering a nested block lights that block's own row only, reaching the
  // same distance past it on both sides.
  await hoverBlock(window, blockId("nested bullet"));
  // The highlight fades in; read it once it has.
  await window.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished)),
  );
  const lit = await window.evaluate(() =>
    [...document.querySelectorAll("main .bn-block-content")]
      .filter((element) => getComputedStyle(element).backgroundColor !== "rgba(0, 0, 0, 0)")
      .filter((element) => element.getAttribute("data-content-type") !== "codeBlock")
      .map((element) => ({
        id: element.closest("[data-id]")!.getAttribute("data-id"),
        shadow: getComputedStyle(element).boxShadow,
      })),
  );
  expect(lit.map(({ id }) => id)).toEqual(["nested-bullet"]);
  const offsets = [...lit[0]!.shadow.matchAll(/(-?[\d.]+)px 0px 0px 0px/g)].map(([, x]) =>
    Number(x),
  );
  expect(offsets).toHaveLength(2);
  expect(offsets[0]! + offsets[1]!).toBe(0);
  expect(Math.abs(offsets[0]!)).toBeGreaterThan(0);
});

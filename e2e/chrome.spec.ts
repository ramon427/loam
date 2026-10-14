import { createServer } from "node:http";
import { inflateSync } from "node:zlib";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Page } from "@playwright/test";

import { DESKTOP, expect, test, type LoamApp } from "./app";
import { createFolder, createNote, noteBody, noteRow, sidebar, storedLibrary } from "./notes";

test("the sidebar filters folders and creates from its header", async ({ loam }) => {
  const { window } = loam;
  await createFolder(window, "Projects");
  await createNote(window, { title: "Plan", body: "Phase one.", folder: "Projects" });
  await createFolder(window, "Archive");
  await createNote(window, { title: "Past work", body: "Complete.", folder: "Archive" });
  await createNote(window, { title: "Scratchpad", body: "Loose ideas." });
  const library = await storedLibrary(window);

  const chooseScope = async (name: string) => {
    await sidebar(window)
      .getByRole("button", { name: /^Filter notes/ })
      .click();
    await window.getByRole("menuitemcheckbox", { name, exact: true }).click();
  };
  // Long menus scroll inside the space left below their trigger.
  await sidebar(window)
    .getByRole("button", { name: /^Filter notes/ })
    .click();
  const menuMaxHeight = await window
    .getByRole("menu")
    .evaluate((menu) => getComputedStyle(menu).maxHeight);
  expect(menuMaxHeight).toMatch(/px$/);
  await window.keyboard.press("Escape");

  await chooseScope("Projects");
  await expect(noteRow(window, "Plan")).toBeVisible();
  await expect(noteRow(window, "Scratchpad")).toHaveCount(0);
  await expect(noteRow(window, "Archive")).toHaveCount(0);
  await expect(noteRow(window, "Past work")).toHaveCount(0);

  // Search can still find every note and reveals its place in the library.
  await sidebar(window).getByRole("searchbox", { name: "Search notes" }).fill("Loose ideas");
  await expect(window.getByRole("list", { name: "Search results" })).toContainText("Scratchpad");
  await window.keyboard.press("Enter");
  await expect(noteRow(window, "Scratchpad")).toBeVisible();
  await expect(noteRow(window, "Archive")).toBeVisible();

  await chooseScope("Unfiled notes");
  await expect(noteRow(window, "Scratchpad")).toBeVisible();
  await expect(noteRow(window, "Projects")).toHaveCount(0);
  await expect(noteRow(window, "Plan")).toHaveCount(0);
  expect(await storedLibrary(window)).toEqual(library);

  // Folders are global; notes stay in the folder selected in the toolbar.
  await createFolder(window, "Ideas");
  await expect(noteRow(window, "Projects")).toBeVisible();
  await expect(noteRow(window, "Archive")).toBeVisible();
  await chooseScope("Projects");
  await createNote(window, { title: "New thought", body: "Created from the toolbar." });
  await expect(noteRow(window, "New thought")).toBeVisible();
  expect(
    (await storedLibrary(window)).notes.find((note) => note.title === "New thought")?.folderId,
  ).toBe(library.folders.find((folder) => folder.name === "Projects")?.id);
});

test("the sidebar collapses without closing the note and restores its state", async ({ loam }) => {
  const { window } = loam;
  await createFolder(window, "Projects");
  await createNote(window, { title: "Plan", body: "Keep this note open.", folder: "Projects" });

  await window.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(window.locator("#notes-sidebar")).toBeHidden();
  await expect(noteBody(window)).toContainText("Keep this note open.");
  await expect.poll(async () => (await window.getByRole("main").boundingBox())?.x).toBe(0);
  await expect(window.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  // Settings remains reachable while the library is hidden.
  await window.keyboard.press("ControlOrMeta+Comma");
  await expect(window.getByRole("main", { name: "Settings", exact: true })).toBeVisible();
  await window.keyboard.press("Escape");
  await loam.restart();
  await expect(loam.window.locator("#notes-sidebar")).toBeHidden();
  await loam.window.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(noteRow(loam.window, "Projects")).toBeVisible();
  await expect(noteRow(loam.window, "Plan")).toBeVisible();

  // Hiding a focused tree row moves focus to the button that can reopen it.
  await noteRow(loam.window, "Plan").focus();
  await loam.window.keyboard.press("ControlOrMeta+b");
  await expect(loam.window.locator("#notes-sidebar")).toBeHidden();
  await expect(loam.window.getByRole("button", { name: "Expand sidebar" })).toBeFocused();
  await loam.window.keyboard.press("ControlOrMeta+b");
  await expect(loam.window.locator("#notes-sidebar")).toBeVisible();

  await noteRow(loam.window, "Plan").click();
  await noteBody(loam.window).click();
  await loam.window.keyboard.press("ControlOrMeta+b");
  await expect(loam.window.locator("#notes-sidebar")).toBeVisible();
});

test(
  "the sidebar toggle takes real clicks over the window's drag area",
  DESKTOP,
  async ({ loam }) => {
    const { window } = loam;
    await createNote(window, { title: "Plan", body: "Steps." });
    await loam.clickThroughWindow(window.getByRole("button", { name: "Collapse sidebar" }));
    await expect(window.locator("#notes-sidebar")).toBeHidden();
    await loam.clickThroughWindow(window.getByRole("button", { name: "Expand sidebar" }));
    await expect(window.locator("#notes-sidebar")).toBeVisible();
  },
);

test("the sidebar resizes with the pointer and keyboard and remembers its width", async ({
  loam,
}) => {
  const sidebarWidth = async () =>
    Math.round((await loam.window.locator("#notes-sidebar").boundingBox())!.width);
  await createNote(loam.window, {
    title: "Resizing check",
    body: "Find this note while resizing.",
  });
  const handle = () => loam.window.getByRole("separator", { name: "Resize sidebar" });
  await expect.poll(sidebarWidth).toBe(280);
  const box = (await handle().boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 100;
  await loam.window.mouse.move(x, y);
  await loam.window.mouse.down();
  await loam.window.mouse.move(x + 120, y, { steps: 8 });
  await loam.window.mouse.up();
  await expect.poll(sidebarWidth).toBe(400);
  await loam.restart();
  await expect.poll(sidebarWidth).toBe(400);

  // A smaller window clamps the visible width without replacing the saved preference.
  await loam.setWindowSize(520, 760);
  await expect.poll(sidebarWidth).toBe(220);
  await loam.setWindowSize(1280, 840);
  await expect.poll(sidebarWidth).toBe(400);
  await handle().focus();
  await loam.window.keyboard.press("ArrowLeft");
  await expect.poll(sidebarWidth).toBe(390);
  await loam.window.keyboard.press("Shift+ArrowRight");
  await expect.poll(sidebarWidth).toBe(440);
  await loam.window.keyboard.press("End");
  await expect.poll(sidebarWidth).toBe(480);
  await loam.window.keyboard.press("Home");
  await expect.poll(sidebarWidth).toBe(220);
  await sidebar(loam.window).getByRole("searchbox", { name: "Search notes" }).fill("resizing");
  const results = loam.window.getByRole("list", { name: "Search results" });
  await expect(results).toContainText("Resizing check");
  const resultsBox = (await results.boundingBox())!;
  const sidebarBox = (await loam.window.locator("#notes-sidebar").boundingBox())!;
  expect(resultsBox.x + resultsBox.width).toBeLessThanOrEqual(sidebarBox.x + sidebarBox.width);
  await results.getByRole("button", { name: /Resizing check/ }).click();
  await handle().dblclick();
  await expect.poll(sidebarWidth).toBe(280);
});

test("Escape cancels a sidebar drag without changing the saved width", async ({ loam }) => {
  const handle = loam.window.getByRole("separator", { name: "Resize sidebar" });
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 100;
  await loam.window.mouse.move(x, y);
  await loam.window.mouse.down();
  await loam.window.mouse.move(x + 160, y, { steps: 8 });
  await expect(handle).toHaveAttribute("aria-valuenow", "440");
  await loam.window.keyboard.press("Escape");
  await loam.window.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", "280");
  await expect(loam.window.locator(".loam-shell")).toHaveAttribute(
    "data-sidebar-resizing",
    "false",
  );
  await loam.restart();
  await expect(loam.window.getByRole("separator", { name: "Resize sidebar" })).toHaveAttribute(
    "aria-valuenow",
    "280",
  );
});

/** The color painted at the window's top-left corner, as `#rrggbb`. */
const paintedTitleBarColor = async (window: Page) => {
  // The window's top row, which the native buttons sit on, starts at that corner.
  const png = await window.screenshot({
    clip: { x: 0, y: 0, width: 1, height: 1 },
    animations: "disabled",
  });
  // The image data is the IDAT chunks' bytes, deflated. Each row starts with a filter byte, and
  // no filter changes the first pixel of the first row.
  const data: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
      data.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const pixel = inflateSync(Buffer.concat(data)).subarray(1, 4);
  return `#${pixel.toString("hex")}`;
};

/** Chooses a theme the way an AI client does, through the app's MCP tool. */
const chooseThemeThroughMcp = async (loam: LoamApp, theme: "light" | "dark") => {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const config = await loam.window.evaluate(async (port) => {
    await window.loam!.invoke("mcp.configure", { enabled: true, port });
    const result = await window.loam!.invoke("mcp.connection", {});
    if (!result.ok) throw new Error(result.error.message);
    return JSON.parse(result.data.config).mcpServers["loam"] as {
      url: string;
      headers: Record<string, string>;
    };
  }, port);
  const client = new Client({ name: "loam-chrome-e2e", version: "1" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: { headers: config.headers },
      }),
    );
    const result = await client.callTool({
      name: "loam_workspace_set_theme",
      arguments: { theme },
    });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  } finally {
    await client.close();
  }
};

test("the native window follows saved and changing themes", async ({ loam }) => {
  const expectMatchingBackground = async () => {
    const painted = await paintedTitleBarColor(loam.window);
    await expect.poll(async () => (await loam.windowBackgroundColor()).toLowerCase()).toBe(painted);
  };
  const html = () => loam.window.locator("html");

  await chooseThemeThroughMcp(loam, "dark");
  await expect(html()).toHaveAttribute("data-theme", "dark");
  await expectMatchingBackground();
  await loam.restart();
  await expect(html()).toHaveAttribute("data-theme", "dark");
  await expectMatchingBackground();
  await chooseThemeThroughMcp(loam, "light");
  await expect(html()).toHaveAttribute("data-theme", "light");
  await expectMatchingBackground();
});

test("the window follows the system's light or dark setting until a theme is saved", async ({
  loam,
}) => {
  const html = loam.window.locator("html");
  await loam.window.emulateMedia({ colorScheme: "light" });
  await expect(html).toHaveAttribute("data-theme", "light");
  await loam.window.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveAttribute("data-theme", "dark");

  // A saved theme stays, whatever the system says.
  await loam.window.evaluate(() => localStorage.setItem("theme", "dark"));
  await loam.window.emulateMedia({ colorScheme: "light" });
  await expect(html).toHaveAttribute("data-theme", "dark");
});

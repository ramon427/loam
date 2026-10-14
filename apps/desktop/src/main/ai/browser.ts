import { BrowserWindow, session, type WebContents } from "electron";
import { z } from "zod";

import { StoreError } from "@loam/storage/storeError";

import type { ChatTool } from "./chatTools";

/** The browser's own storage: its cookies and sign-ins stay apart from the app's. */
const PARTITION = "persist:loam-ai-browser";
const LOAD_TIMEOUT_MS = 20_000;
const MAX_PAGE_TEXT = 40_000;
const MAX_ELEMENTS = 300;
/** A world of its own for the reading script, so the page's scripts can't see or change it. */
const ISOLATED_WORLD = 1001;

const urlSchema = z
  .string()
  .max(4000)
  .transform((url) => (/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`))
  .refine((url) => /^https?:\/\//i.test(url), "Only http and https pages can be opened.");

/**
 * Marks the page's visible controls with numbers and returns the page as
 * text with that list, so the model can say what to click or type into.
 */
const SNAPSHOT_SCRIPT = `(() => {
  const selector = 'a[href], button, input:not([type=hidden]), textarea, select, summary, [role=button], [role=link], [role=checkbox], [role=tab], [role=menuitem], [contenteditable=""], [contenteditable=true]';
  document.querySelectorAll('[data-loam-ref]').forEach((element) => element.removeAttribute('data-loam-ref'));
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const name = (element) =>
    (element.getAttribute('aria-label') || element.innerText || element.value || element.placeholder || element.title || element.alt || element.name || '')
      .replace(/\\s+/g, ' ').trim().slice(0, 80);
  const elements = [];
  for (const element of document.querySelectorAll(selector)) {
    if (elements.length >= ${MAX_ELEMENTS}) break;
    if (!visible(element)) continue;
    const ref = elements.length + 1;
    element.setAttribute('data-loam-ref', String(ref));
    const kind = element.getAttribute('role') || (element.tagName === 'INPUT' ? 'input:' + (element.type || 'text') : element.tagName.toLowerCase());
    elements.push('[' + ref + '] ' + kind + ' "' + name(element) + '"' + (element.href ? ' -> ' + element.href : ''));
  }
  const headings = [...document.querySelectorAll('h1, h2, h3')].filter(visible).slice(0, 40)
    .map((heading) => heading.tagName.toLowerCase() + ': ' + heading.innerText.replace(/\\s+/g, ' ').trim());
  const text = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n');
  return { title: document.title, url: location.href, headings, text: text.slice(0, ${MAX_PAGE_TEXT}), truncated: text.length > ${MAX_PAGE_TEXT}, elements };
})()`;

/** Where a marked control is on screen, scrolled into view first. */
const locateScript = (ref: number) => `(() => {
  const element = document.querySelector('[data-loam-ref="${ref}"]');
  if (!element) return null;
  element.scrollIntoView({ block: 'center', inline: 'center' });
  const box = element.getBoundingClientRect();
  return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
})()`;

/**
 * A web browser the side chat's assistant uses, in a window of its own so
 * the user sees every page it opens and every click. Its sign-ins stay in
 * their own storage, apart from the app and the notes.
 */
export const createAiBrowser = () => {
  let window: BrowserWindow | null = null;

  const open = () => {
    if (window && !window.isDestroyed()) return window;
    const browserSession = session.fromPartition(PARTITION);
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    window = new BrowserWindow({
      width: 1100,
      height: 800,
      title: "Loam browser",
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        partition: PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    // Pages stay in this window; links that open new windows load here instead.
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) void window?.loadURL(url);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (!/^https?:/i.test(url)) event.preventDefault();
    });
    window.on("closed", () => (window = null));
    window.showInactive();
    return window;
  };

  /** Waits for the page to settle after a navigation or a click. */
  const settle = (contents: WebContents) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        contents.off("did-stop-loading", done);
        // Pages often draw a moment after loading.
        setTimeout(resolve, 400);
      };
      const timer = setTimeout(done, LOAD_TIMEOUT_MS);
      if (!contents.isLoading()) setTimeout(done, 600);
      contents.on("did-stop-loading", done);
    });

  const snapshot = async () => {
    const contents = open().webContents;
    const page = (await contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [
      { code: SNAPSHOT_SCRIPT },
    ])) as {
      title: string;
      url: string;
      headings: string[];
      text: string;
      truncated: boolean;
      elements: string[];
    };
    return {
      title: page.title,
      url: page.url,
      headings: page.headings.join("\n"),
      text: page.truncated ? `${page.text}\n… (cut off; scroll for more)` : page.text,
      controls: page.elements.join("\n"),
    };
  };

  const locate = async (ref: number) => {
    const contents = open().webContents;
    const point = (await contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [
      { code: locateScript(ref) },
    ])) as { x: number; y: number } | null;
    if (!point)
      throw new StoreError(
        `There is no control [${ref}] on the page now. Read the page again.`,
        "NOT_FOUND",
        404,
      );
    return point;
  };

  const click = async (ref: number) => {
    const contents = open().webContents;
    const { x, y } = await locate(ref);
    contents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    contents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  };

  const hostOf = (url: unknown) => {
    try {
      return new URL(String(url)).host;
    } catch {
      return String(url);
    }
  };
  const currentHost = () =>
    window && !window.isDestroyed() ? hostOf(window.webContents.getURL()) : "";
  const describe = (label: string) => async () => ({ label, noteId: null });

  const tools: ChatTool[] = [
    {
      name: "loam_browser_open",
      description:
        "Open a web page in Loam's browser window, which the user can see, and return its text and numbered controls. Use it to search the web too, for example https://duckduckgo.com/?q=your+query.",
      inputSchema: z.strictObject({ url: z.string().max(4000) }),
      access: "web",
      describe: async (input) => ({
        label: `Opened ${hostOf(urlSchema.safeParse(input.url).data ?? input.url)}`,
        noteId: null,
      }),
      async run(input) {
        const url = urlSchema.parse(input.url);
        const contents = open().webContents;
        await Promise.all([contents.loadURL(url).catch(() => undefined), settle(contents)]);
        return { result: await snapshot(), undo: null };
      },
    },
    {
      name: "loam_browser_read",
      description:
        'Read the page open in Loam\'s browser again: its text and numbered controls ([3] button "Sign in"). Controls are renumbered on every read.',
      inputSchema: z.strictObject({}),
      access: "read",
      describe: async () => ({ label: `Read ${currentHost() || "the page"}`, noteId: null }),
      run: async () => ({ result: await snapshot(), undo: null }),
    },
    {
      name: "loam_browser_scroll",
      description: "Scroll the page in Loam's browser down or up by a screen, then read it.",
      inputSchema: z.strictObject({ direction: z.enum(["down", "up"]) }),
      access: "read",
      describe: describe("Scrolled the page"),
      async run(input) {
        const contents = open().webContents;
        const sign = input.direction === "up" ? -1 : 1;
        await contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [
          { code: `window.scrollBy(0, ${sign} * window.innerHeight * 0.9)` },
        ]);
        await settle(contents);
        return { result: await snapshot(), undo: null };
      },
    },
    {
      name: "loam_browser_back",
      description: "Go back to the previous page in Loam's browser, then read it.",
      inputSchema: z.strictObject({}),
      access: "read",
      describe: describe("Went back a page"),
      async run() {
        const contents = open().webContents;
        if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
        await settle(contents);
        return { result: await snapshot(), undo: null };
      },
    },
    {
      name: "loam_browser_click",
      description:
        "Click a numbered control from the last read of Loam's browser page, then read the page again. Clicking can submit forms or buy things; it acts as the user.",
      inputSchema: z.strictObject({ ref: z.number().int().positive() }),
      access: "outside",
      describe: async (input) => ({
        label: `Clicked [${String(input.ref)}] on ${currentHost() || "a page"}`,
        noteId: null,
      }),
      async run(input) {
        const contents = open().webContents;
        await click(Number(input.ref));
        await settle(contents);
        return { result: await snapshot(), undo: null };
      },
    },
    {
      name: "loam_browser_type",
      description:
        "Type into a numbered text field from the last read of Loam's browser page, replacing what it holds; submit presses Enter afterwards. Then read the page again.",
      inputSchema: z.strictObject({
        ref: z.number().int().positive(),
        text: z.string().max(20_000),
        submit: z.boolean().optional(),
      }),
      access: "outside",
      describe: async () => ({ label: `Typed on ${currentHost() || "a page"}`, noteId: null }),
      preview: async (input) => String(input.text),
      async run(input) {
        const contents = open().webContents;
        await click(Number(input.ref));
        contents.selectAll();
        await contents.insertText(String(input.text));
        if (input.submit) {
          contents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
          contents.sendInputEvent({ type: "char", keyCode: "\r" });
          contents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
        }
        await settle(contents);
        return { result: await snapshot(), undo: null };
      },
    },
  ];

  return {
    tools,
    close() {
      if (window && !window.isDestroyed()) window.destroy();
      window = null;
    },
  };
};

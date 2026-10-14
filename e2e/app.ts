import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";

// A frozen build can be supplied when another workspace process is rebuilding the app.
const APP_DIRECTORY =
  process.env.LOAM_E2E_APP_DIRECTORY ?? join(import.meta.dirname, "..", "apps", "desktop");
/** Written by the main process (with LOAM_E2E=1) once its store is closed. */
const QUIT_MARKER = "loam-e2e: store closed";

type Running = { app: ElectronApplication; window: Page };

async function launch(dataDirectory: string, profileDirectory: string): Promise<Running> {
  const app = await electron.launch({
    args: [
      APP_DIRECTORY,
      `--user-data-dir=${profileDirectory}`,
      // Linux development checkouts can't run Chromium's setuid sandbox helper.
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    ],
    env: { ...process.env, LOAM_DATA_DIR: dataDirectory, LOAM_E2E: "1" } as Record<string, string>,
  });
  const window = await app.firstWindow();
  // The library, or the unlock screen when the notes are encrypted.
  await window
    .getByRole("button", { name: /^(New note|Expand sidebar)$/ })
    .first()
    .or(window.getByRole("heading", { name: "Your notes are locked" }))
    .waitFor();
  return { app, window };
}

const isRunning = ({ app }: Running) => {
  const child = app.process();
  return child.exitCode === null && child.signalCode === null;
};

/**
 * Resolves once the app has closed its store. A process started by Playwright
 * then waits for the debugger to detach (silently, running nothing else), so
 * it is ended at that point.
 */
async function waitForQuit({ app }: Running) {
  const child = app.process();
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.stderr?.on("data", (chunk: Buffer) => {
      if (String(chunk).includes(QUIT_MARKER)) resolve();
    });
  });
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exited;
  }
}

async function quit(running: Running) {
  if (!isRunning(running)) return;
  const quitted = waitForQuit(running);
  // The app may quit before it answers, so don't wait for a reply.
  void running.app.evaluate(({ app }) => app.quit()).catch(() => undefined);
  await quitted;
}

/** One Loam app on its own empty data and profile folders. */
export class LoamApp {
  readonly root = mkdtempSync(join(tmpdir(), "loam-e2e-"));
  /** Notes, media and backups (LOAM_DATA_DIR). */
  readonly dataDirectory = join(this.root, "data");
  private running: Running | null = null;

  get window(): Page {
    if (!this.running) throw new Error("The app isn't running.");
    return this.running.window;
  }

  async start() {
    this.running = await launch(this.dataDirectory, join(this.root, "profile"));
  }

  /** Quits the way a user would, waiting until the store is closed. */
  async quit() {
    if (this.running) await quit(this.running);
    this.running = null;
  }

  async restart() {
    await this.quit();
    await this.start();
  }

  async writeClipboard(text: string) {
    await this.running!.app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);
  }

  /**
   * Records the native context menus the app opens instead of showing them (a test can't
   * click a native menu), and returns a reader for each menu's item roles and labels.
   */
  async recordNativeMenus() {
    await this.running!.app.evaluate(({ Menu }) => {
      const opened: string[][] = [];
      Object.assign(globalThis, { loamNativeMenus: opened });
      Menu.prototype.popup = function () {
        opened.push(
          this.items
            .filter((item) => item.type !== "separator")
            .map((item) => item.role ?? item.label),
        );
      };
    });
    return () =>
      this.running!.app.evaluate(
        () => (globalThis as unknown as { loamNativeMenus: string[][] }).loamNativeMenus,
      );
  }

  /** The native window background, which should follow the renderer's theme. */
  async windowBackgroundColor() {
    return this.running!.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getBackgroundColor(),
    );
  }

  /**
   * Clicks the middle of `target` through the window system, as a user does. Playwright's own
   * clicks go straight to the page, past the window's drag areas, which turn real clicks into
   * window moves. Needs an X display (xvfb-run) and xdotool.
   */
  async clickThroughWindow(target: Locator) {
    const bounds = await this.running!.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getContentBounds(),
    );
    const box = (await target.boundingBox())!;
    const x = Math.round(bounds.x + box.x + box.width / 2);
    const y = Math.round(bounds.y + box.y + box.height / 2);
    execFileSync("xdotool", ["mousemove", String(x), String(y), "click", "1"]);
  }

  /** Resizes the real Electron window, including the renderer's responsive layout. */
  async setWindowSize(width: number, height: number) {
    await this.running!.app.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0]!.setSize(size.width, size.height),
      { width, height },
    );
  }

  /** Answers the next native open dialogs with `paths`, or cancels when null. */
  async answerFilePickers(paths: string[] | null) {
    await this.running!.app.evaluate(({ dialog }, filePaths) => {
      dialog.showOpenDialog = (async () =>
        filePaths
          ? { canceled: false, filePaths }
          : { canceled: true, filePaths: [] }) as typeof dialog.showOpenDialog;
    }, paths);
  }

  /** Moves the main process's clock forward, for rules that wait on time. */
  async advanceClock(ms: number) {
    await this.running!.app.evaluate((_, offset) => {
      const now = Date.now;
      Date.now = () => now() + offset;
    }, ms);
  }

  /**
   * Runs `action`, which makes the app restart itself (as a restore does),
   * and starts it again: a test can't follow Electron's own relaunch.
   */
  async expectSelfRestart(action: () => Promise<void>) {
    const running = this.running!;
    await running.app.evaluate(({ app }) => {
      app.relaunch = () => undefined;
    });
    const quitted = waitForQuit(running);
    await action();
    await quitted;
    await this.start();
  }

  async dispose() {
    await this.quit();
    rmSync(this.root, { recursive: true, force: true });
  }
}

/** Tests get a started app as `loam`; it is quit and its folders removed afterwards. */
export const test = base.extend<{ loam: LoamApp }>({
  loam: async ({}, use) => {
    const loam = new LoamApp();
    try {
      await loam.start();
      await use(loam);
    } finally {
      await loam.dispose();
    }
  },
});

/**
 * For tests that use what the computer has only one of, the system clipboard
 * or the mouse, so they run one at a time after the others (see the config).
 */
export const DESKTOP = { tag: "@desktop" };

export { expect } from "@playwright/test";

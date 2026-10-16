import { join } from "node:path";

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  nativeImage,
  nativeTheme,
  screen,
  shell,
  type BrowserWindowConstructorOptions,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";

import {
  LOAM_BRIDGE_EVENT_CHANNEL,
  type LoamBridgeEvent,
  type LoamBridgeEvents,
} from "@loam/shared/bridge/loamBridge";

import { contextMenuTemplate } from "./contextMenu";
import { createNavigationPolicy, isSafeExternalUrl } from "./navigation";
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  readWindowBounds,
  writeWindowBounds,
} from "./windowState";

type Theme = "light" | "dark";
type TitleBarColors = { color: string; symbolColor: string };

/**
 * The window's top row. The renderer reads it from the native buttons on
 * Windows and Linux; on macOS its styles fall back to the same 44px.
 */
const TITLEBAR_HEIGHT = 44;
const MACOS_WINDOW_BUTTON_RADIUS = 7;

const themeColors = (theme: Theme): TitleBarColors =>
  theme === "dark"
    ? { color: "#131313", symbolColor: "#b7b7b7" }
    : { color: "#f3f3f4", symbolColor: "#555555" };

/**
 * The app draws its own title bar. Windows and Linux keep native minimize,
 * maximize and close buttons drawn over it (so snap layouts and accessibility
 * keep working); macOS keeps its traffic lights, moved into the bar.
 */
const titleBarOptions = (
  theme: Theme,
): Pick<
  BrowserWindowConstructorOptions,
  "titleBarStyle" | "titleBarOverlay" | "trafficLightPosition"
> =>
  process.platform === "darwin"
    ? {
        titleBarStyle: "hiddenInset",
        trafficLightPosition: { x: 16, y: TITLEBAR_HEIGHT / 2 - MACOS_WINDOW_BUTTON_RADIUS },
      }
    : {
        titleBarStyle: "hidden",
        titleBarOverlay: { ...themeColors(theme), height: TITLEBAR_HEIGHT },
      };

/** Fully transparent, so the window's glass shows through the page. */
const CLEAR = "#00000000";

/**
 * Lets the desktop show through the window, blurred by the system: vibrancy on macOS, acrylic on
 * Windows 11 (older Windows ignores it). Linux has no system blur, so it keeps a solid window.
 */
const setWindowGlass = (window: BrowserWindow, glass: boolean) => {
  if (process.platform === "darwin") window.setVibrancy(glass ? "under-window" : null);
  else if (process.platform === "win32") window.setBackgroundMaterial(glass ? "acrylic" : "none");
};

const supportsGlass = () => process.platform === "darwin" || process.platform === "win32";

const openExternal = (url: string) => {
  if (isSafeExternalUrl(url)) shell.openExternal(url).catch(() => undefined);
};

/**
 * The app's one window: it loads the renderer, keeps navigation inside it,
 * and is the only sender the main process takes requests from.
 */
export const createMainWindow = ({
  rendererUrl,
  automatedRun,
  onClosed,
}: {
  rendererUrl: string;
  /** End-to-end tests can't answer native dialogs. */
  automatedRun: boolean;
  onClosed: () => void;
}) => {
  const navigationPolicy = createNavigationPolicy(rendererUrl);
  let window: BrowserWindow | null = null;
  /** The window's page has loaded the app (its scripts ran), so it can answer requests. */
  let pageReady = false;
  /** Runs once the window has closed (installing an update), unless the user keeps it open. */
  let afterClose: (() => void) | null = null;
  /** Whether the window shows the desktop through it; see setWindowGlass. */
  let glassShown = false;

  const current = () => (window && !window.isDestroyed() ? window : null);
  const isWindowContents = (contents: WebContents | null | undefined) =>
    Boolean(current() && contents?.id === window!.webContents.id);

  const open = () => {
    const boundsPath = join(app.getPath("userData"), "window-state.json");
    const theme: Theme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
    const created = new BrowserWindow({
      ...readWindowBounds(boundsPath, screen.getAllDisplays()),
      minWidth: MIN_WINDOW_WIDTH,
      minHeight: MIN_WINDOW_HEIGHT,
      show: false,
      title: "Loam",
      ...titleBarOptions(theme),
      backgroundColor: themeColors(theme).color,
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        spellcheck: true,
      },
    });
    window = created;
    pageReady = false;
    glassShown = false;
    created.webContents.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument) pageReady = false;
    });
    // Only the top frame's document; the app's module scripts have run by then.
    created.webContents.on("dom-ready", () => {
      pageReady = true;
    });
    created.webContents.on("will-attach-webview", (event) => event.preventDefault());
    created.webContents.on("will-navigate", (event, url) => {
      if (navigationPolicy.isInternalUrl(url)) return;
      event.preventDefault();
      openExternal(url);
    });
    created.webContents.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: "deny" };
    });
    created.webContents.on("context-menu", (_event, params) => {
      const template = contextMenuTemplate(params, {
        copyText: (text) => clipboard.writeText(text),
        openExternal,
        copyImage: () => created.webContents.copyImageAt(params.x, params.y),
      });
      if (template.length > 0) Menu.buildFromTemplate(template).popup({ window: created });
    });
    created.once("ready-to-show", () => created.show());
    // The notes screen asks before leaving with unsaved edits; Electron would
    // otherwise refuse to close silently, so ask in a native dialog.
    created.webContents.on("will-prevent-unload", (event) => {
      // Automated runs can't answer a dialog; they check saved data after a restart.
      if (automatedRun) return event.preventDefault();
      const choice = dialog.showMessageBoxSync(created, {
        type: "warning",
        buttons: ["Wait", "Close anyway"],
        defaultId: 0,
        cancelId: 0,
        message: "Some changes haven't been saved yet.",
        detail: "Wait a moment for them to save, or close now and they may be lost.",
      });
      if (choice === 1) event.preventDefault();
      else afterClose = null;
    });
    created.on("close", () => {
      if (!created.isMinimized()) writeWindowBounds(boundsPath, created.getNormalBounds());
    });
    created.on("closed", () => {
      if (window === created) window = null;
      onClosed();
      const action = afterClose;
      afterClose = null;
      action?.();
    });
    void created.loadURL(rendererUrl);
  };

  return {
    current,
    /** The window has loaded the app, so it can answer requests. */
    isReady: () => Boolean(current()) && pageReady,
    /** Opens the window, or brings the open one to the front. */
    show() {
      const shown = current();
      if (!shown) return open();
      if (shown.isMinimized()) shown.restore();
      shown.focus();
    },

    /** Requests come only from the window's own top frame, showing the app. */
    isTrustedSender(event: IpcMainInvokeEvent) {
      return (
        isWindowContents(event.sender) &&
        event.senderFrame === event.sender.mainFrame &&
        navigationPolicy.isInternalUrl(event.senderFrame?.url ?? "")
      );
    },

    send<E extends LoamBridgeEvent>(event: E, payload: LoamBridgeEvents[E]) {
      current()?.webContents.send(LOAM_BRIDGE_EVENT_CHANNEL, event, payload);
      return Boolean(current());
    },

    /**
     * Puts an image on the system clipboard; false when Electron can't read its type (it reads
     * PNG and JPEG).
     */
    copyImage(bytes: Uint8Array) {
      const image = nativeImage.createFromBuffer(Buffer.from(bytes));
      if (image.isEmpty()) return false;
      clipboard.writeImage(image);
      return true;
    },

    /** Keeps the native window controls, and the window's glass, in the renderer's theme. */
    setTheme(theme: Theme, colors: TitleBarColors = themeColors(theme), glass = false) {
      const shown = current();
      if (!shown) return;
      const showGlass = glass && supportsGlass();
      if (showGlass !== glassShown) {
        setWindowGlass(shown, showGlass);
        glassShown = showGlass;
      }
      shown.setBackgroundColor(showGlass ? CLEAR : colors.color);
      if (process.platform !== "darwin")
        shown.setTitleBarOverlay(showGlass ? { ...colors, color: CLEAR } : colors);
    },

    /**
     * Closes the window the way the user would, so the notes screen can ask
     * about unsaved edits, and runs `action` once it has closed.
     */
    closeThen(action: () => void) {
      const shown = current();
      if (!shown) return action();
      afterClose = action;
      // After the current request's reply, which a closed window couldn't receive.
      setTimeout(() => shown.close(), 0);
    },

    /** Closes the window without its unload handlers, so it can't write anything back. */
    destroy() {
      const shown = current();
      window = null;
      shown?.destroy();
    },
  };
};

export type MainWindow = ReturnType<typeof createMainWindow>;

import { join } from "node:path";

import { app, BrowserWindow, dialog, Menu, protocol, safeStorage, session, shell } from "electron";
import { autoUpdater } from "electron-updater";

import {
  LOAM_APP_ORIGIN,
  LOAM_APP_PROTOCOL,
  LOAM_MEDIA_PROTOCOL,
} from "@loam/shared/bridge/loamBridge";

import { buildContentSecurityPolicy } from "../shared/contentSecurityPolicy";
import { macAppMenuTemplate } from "./appMenu";
import { createAiBrowser } from "./ai/browser";
import { createChatTools } from "./ai/chatTools";
import { createAiService, type AiService } from "./ai/service";
import { webReadTool } from "./ai/webRead";
import { createWorkspaceRequests } from "./workspaceRequests";
import { createCustomizations } from "./customizations";
import { createDialogs } from "./dialogs";
import { loadEncryption, type EncryptionManager } from "./encryption/encryption";
import { createGoogleAccount, type GoogleAccount } from "./google/googleAccount";
import { endpointsAt, GOOGLE_ENDPOINTS } from "./google/googleOAuth";
import { openLibrary } from "./library";
import { createLibraryGate, type LibraryGate } from "./libraryGate";
import { createMcpService, type McpService } from "./mcp/service";
import { createMcpTools, type ToolDefinition } from "./mcp/tools";
import { createPlugins } from "./plugins/plugins";
import { createRendererProtocolHandler } from "./rendererProtocol";
import { createSecretBox } from "./sealedSecrets";
import { installSessionPolicies } from "./sessionPolicies";
import { openablePathsIn } from "./tabFiles";
import { createDispatch, installIpc, type Dispatch } from "./requests/dispatch";
import { createHandlers, type AppServices } from "./requests/handlers";
import { createUpdateService } from "./updates";
import { createMainWindow } from "./window";

const APP_ID = "io.github.ramon427.loam";
/** How long quitting waits for sync to publish the last edits. */
const SYNC_FLUSH_ON_QUIT_MS = 3000;
/** Long enough for the window to show that it is restarting after a restore. */
const RESTART_DELAY_MS = 1200;
/** The end-to-end harness waits for this before it ends the test's app. */
const E2E_QUIT_MARKER = "loam-e2e: store closed";

protocol.registerSchemesAsPrivileged([
  {
    scheme: LOAM_APP_PROTOCOL,
    privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
  },
  {
    scheme: LOAM_MEDIA_PROTOCOL,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

// A development renderer URL is honoured only for unpackaged runs.
const devServerUrl = app.isPackaged ? null : (process.env.LOAM_RENDERER_URL ?? null);
const rendererUrl = devServerUrl
  ? new URL("/notes", devServerUrl).toString()
  : `${LOAM_APP_ORIGIN}/notes`;
const dataDirectory = process.env.LOAM_DATA_DIR || join(app.getPath("userData"), "data");
// End-to-end tests (e2e/) run the unpackaged app with LOAM_E2E=1.
const automatedRun = !app.isPackaged && process.env.LOAM_E2E === "1";
// A display-less Linux has no keychain; the tests' side chat keys may be stored in plain text.
const plainTextKeys = automatedRun && process.platform === "linux";
if (plainTextKeys) safeStorage.setUsePlainTextEncryption(true);
// End-to-end tests sign in to a fake Google on this computer; no other run can move Google.
const googleEndpoints =
  automatedRun && process.env.LOAM_E2E_GOOGLE_URL
    ? endpointsAt(process.env.LOAM_E2E_GOOGLE_URL)
    : GOOGLE_ENDPOINTS;

const aiBrowser = createAiBrowser();
const mainWindow = createMainWindow({
  rendererUrl,
  automatedRun,
  // The side chat's browser goes with the app's window, so the app can quit.
  onClosed: () => {
    workspace.close();
    aiBrowser.close();
  },
});
// Files the system asks the app to open ("Open with", or a file dropped on its icon) wait
// here until the window, with the notes open, takes them.
const waitingFiles = openablePathsIn(process.argv.slice(1));
const fileWaiting = (paths: readonly string[]) => {
  if (paths.length === 0) return;
  waitingFiles.push(...paths);
  mainWindow.send("files.waiting", null);
};
// macOS names the file in an event, which can come before the app is ready.
app.on("open-file", (event, path) => {
  event.preventDefault();
  fileWaiting([path]);
});

const workspace = createWorkspaceRequests({
  send: (request) => mainWindow.isReady() && mainWindow.send("app.automation", request),
  isWindowReady: () => mainWindow.isReady(),
});

/** The notes, once open: at launch, or after unlocking when they are encrypted. Quitting closes them. */
let gate: LibraryGate | null = null;
let mcp: McpService | null = null;
let ai: AiService | null = null;
let google: GoogleAccount | null = null;
// Set while the app restarts after a restore, so closing the window doesn't quit early.
let restarting = false;

/**
 * After a restore the window's own copies of notes (its save queue and
 * recovery copies) describe data that no longer exists. Close it without
 * unload handlers, so it can't write them back, clear them and relaunch.
 */
const restartAfterRestore = async () => {
  restarting = true;
  mainWindow.destroy();
  await session.defaultSession.clearStorageData({ storages: ["localstorage", "indexdb"] });
  app.relaunch();
  app.quit();
};

const start = async () => {
  await app.whenReady();
  app.setAppUserModelId(APP_ID);
  if (process.platform === "darwin")
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        macAppMenuTemplate({
          appName: app.name,
          developerTools: !app.isPackaged,
          openExternal: (url) => void shell.openExternal(url).catch(() => undefined),
        }),
      ),
    );
  let encryption: EncryptionManager;
  let libraryGate: LibraryGate;
  try {
    encryption = await loadEncryption(dataDirectory);
    libraryGate = gate = createLibraryGate({
      encryption,
      open: () =>
        openLibrary({
          dataDirectory,
          encryption,
          appVersion: app.getVersion(),
          onSyncStatus: (status) => mainWindow.send("sync.status", status),
          onNotesChange: (change) => mainWindow.send("notes.changed", change),
          onLinkedFileChange: (path) => mainWindow.send("files.changed", { path }),
          onRestored: () => {
            setTimeout(() => void restartAfterRestore(), RESTART_DELAY_MS);
          },
        }),
      onStatus: (status) => mainWindow.send("security.status", status),
      // The side chat is made below; the key changes only on a request, once it exists.
      keyChange: { before: () => ai!.beforeKeyChange(), after: () => ai!.afterKeyChange() },
    });
    // Encrypted notes open once the window has asked for the passphrase.
    await libraryGate.openIfUnencrypted();
  } catch (error) {
    dialog.showErrorBox(
      "Loam could not open your notes",
      `${error instanceof Error ? error.message : String(error)}\n\nData folder: ${dataDirectory}`,
    );
    app.exit(1);
    return;
  }

  // The Windows installer updates itself. macOS installs only signed updates, so the unsigned
  // Mac app looks for them and links to the download. Development runs never look.
  const updater =
    app.isPackaged && (process.platform === "win32" || process.platform === "darwin")
      ? autoUpdater
      : null;
  const updates = createUpdateService({
    updater,
    installs: process.platform === "win32",
    onStatus: (status) => mainWindow.send("updates.status", status),
  });
  let tools: readonly ToolDefinition[] = [];
  mcp = await createMcpService({
    dataDirectory,
    version: app.getVersion(),
    tools: () => tools,
    stdioCommand: process.execPath,
    stdioArgs: [
      app.isPackaged
        ? join(process.resourcesPath, "app.asar.unpacked", "dist-electron", "mcp.cjs")
        : join(__dirname, "mcp.cjs"),
    ],
    stdioEnv: { ELECTRON_RUN_AS_NODE: "1" },
  });

  // The side chat calls the same requests and tools AI clients do, made below.
  let dispatch: Dispatch | null = null;
  ai = await createAiService({
    dataDirectory,
    plainTextKeys,
    version: app.getVersion(),
    chatTools: createChatTools({
      dispatch: (method, params, caller) => dispatch!(method, params, caller),
      workspace,
      tools: () => tools,
      extra: [webReadTool, ...aiBrowser.tools],
    }),
    libraryKey: () => encryption.current()?.key ?? null,
    send: {
      status: (status) => mainWindow.send("ai.status", status),
      event: (event) => mainWindow.send("ai.event", event),
    },
  });
  const customizations = createCustomizations({
    dataDirectory,
    onChange: () => mainWindow.send("customizations.changed", null),
  });
  void customizations.start();
  app.on("will-quit", () => customizations.close());
  google = createGoogleAccount({
    dataDirectory,
    endpoints: googleEndpoints,
    secrets: createSecretBox({ plainText: plainTextKeys }),
    openBrowser: (url) => shell.openExternal(url),
    onStatus: (status) => mainWindow.send("google.status", status),
  });
  const plugins = createPlugins({
    dataDirectory,
    bundledDirectory: join(__dirname, "plugins"),
    library: () => libraryGate.library(),
    google,
    onChange: () => mainWindow.send("plugins.changed", null),
  });
  void plugins.start();
  app.on("will-quit", () => plugins.close());

  const services: AppServices = {
    info: { version: app.getVersion(), dataDirectory },
    window: mainWindow,
    dialogs: createDialogs(() => mainWindow.current()),
    customizations,
    encryption,
    gate: libraryGate,
    mcp,
    ai,
    google,
    plugins,
    updates,
    workspace,
    takeWaitingFiles: () => waitingFiles.splice(0),
    revealDataDirectory: async () => {
      await shell.openPath(dataDirectory);
    },
    // Closes the window first, so the notes screen can ask about unsaved edits like any other close.
    restartToUpdate: () => {
      if (updates.status().state !== "ready") return;
      mainWindow.closeThen(() => {
        updates.install();
        // Installing quits on its own; this still quits if the installer couldn't start.
        app.quit();
      });
    },
  };
  dispatch = createDispatch(createHandlers(services), libraryGate);
  tools = createMcpTools({ dispatch, app: services });

  if (!devServerUrl) {
    protocol.handle(
      LOAM_APP_PROTOCOL,
      createRendererProtocolHandler(
        join(__dirname, "..", "dist-renderer"),
        buildContentSecurityPolicy(),
      ),
    );
  }
  protocol.handle(LOAM_MEDIA_PROTOCOL, (request) => {
    const library = libraryGate.current();
    return library
      ? library.media.handleRequest(request)
      : new Response("Not found", { status: 404 });
  });
  installSessionPolicies({ window: mainWindow, rendererUrl });
  installIpc(mainWindow, dispatch);
  mainWindow.show();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow.show();
  });
};

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !restarting) app.quit();
});

let closing = false;
app.on("will-quit", (event) => {
  if (closing) return;
  closing = true;
  event.preventDefault();
  void (async () => {
    workspace.close();
    await mcp?.close().catch(() => undefined);
    await ai?.close().catch(() => undefined);
    google?.close();
    // Publish the last edits first, so other devices have them while this one is off.
    await gate
      ?.current()
      ?.close(SYNC_FLUSH_ON_QUIT_MS)
      .catch(() => undefined);
    if (automatedRun) process.stderr.write(`${E2E_QUIT_MARKER}\n`);
    app.quit();
  })();
});

// One process owns the database; a second launch brings the open window forward.
if (app.requestSingleInstanceLock()) {
  app.on("second-instance", (_event, argv) => {
    if (mainWindow.current()) mainWindow.show();
    fileWaiting(openablePathsIn(argv.slice(1)));
  });
  void start();
} else {
  app.quit();
}

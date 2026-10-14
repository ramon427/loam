import type { BridgeSecurityStatus } from "@loam/shared/bridge/loamBridge";
import type { NotesStore } from "@loam/storage/NotesStore";
import { StoreError } from "@loam/storage/storeError";

import type { OpenLibrary } from "../library";
import { createLibraryGate } from "../libraryGate";
import type { MediaStore } from "../mediaStore";
import { createDispatch } from "../requests/dispatch";
import { createHandlers, type AppServices } from "../requests/handlers";

/** What unlocks a test app's locked notes. */
export const TEST_PASSPHRASE = "correct horse battery";

const unavailable = (what: string) => () => {
  throw new StoreError(`${what} isn't part of this test.`, "UNAVAILABLE", 503);
};

/** Encryption as far as the library gate sees it: locked until `TEST_PASSPHRASE` is entered. */
const testEncryption = (locked: boolean) => {
  let state: BridgeSecurityStatus["state"] = locked ? "locked" : "off";
  const unlock = async (secret: string) => {
    if (secret !== TEST_PASSPHRASE)
      throw new StoreError("That passphrase isn't right.", "WRONG_PASSPHRASE", 403);
    state = "on";
  };
  return {
    status: (): BridgeSecurityStatus => ({ state }),
    unlock,
    resetPassphrase: (recoveryKey: string) => unlock(recoveryKey),
    enable: unavailable("Encryption"),
    disable: unavailable("Encryption"),
    adoptSyncFolderKey: unavailable("Encryption"),
  };
};

/**
 * The request handlers over a real store, as the app wires them, behind a
 * real library gate: open, or locked until `TEST_PASSPHRASE` unlocks it.
 * `media` is the library's image folder, for the image requests.
 * Services a test doesn't set (the window, dialogs, encryption, sync) fail
 * when used.
 */
export const createTestApp = async (
  store: NotesStore,
  {
    locked = false,
    media,
    ...overrides
  }: Partial<AppServices> & { locked?: boolean; media?: MediaStore } = {},
) => {
  const library = { store, media } as unknown as OpenLibrary;
  const gate = createLibraryGate({
    encryption: testEncryption(locked),
    open: async () => library,
    onStatus: () => undefined,
    keyChange: { before: async () => undefined, after: async () => undefined },
  });
  await gate.openIfUnencrypted();
  const app = {
    info: { version: "test", dataDirectory: "/data" },
    gate,
    restartToUpdate: () => undefined,
    takeWaitingFiles: () => [],
    revealDataDirectory: unavailable("The file manager"),
    workspace: {
      flush: async () => undefined,
      request: unavailable("The window"),
      respond: () => undefined,
      close: () => undefined,
    },
    window: new Proxy({}, { get: () => unavailable("The window") }),
    dialogs: new Proxy({}, { get: () => unavailable("A dialog") }),
    customizations: new Proxy({}, { get: () => unavailable("Customizations") }),
    encryption: new Proxy({}, { get: () => unavailable("Encryption") }),
    mcp: new Proxy({}, { get: () => unavailable("AI access") }),
    ai: new Proxy({}, { get: () => unavailable("The side chat") }),
    plugins: new Proxy({}, { get: () => unavailable("Plugins") }),
    updates: new Proxy({}, { get: () => unavailable("Updates") }),
    ...overrides,
  } as AppServices;
  return { app, dispatch: createDispatch(createHandlers(app), gate) };
};

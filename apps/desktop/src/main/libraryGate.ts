import type { BridgeSecurityStatus, LoamBridgeMethod } from "@loam/shared/bridge/loamBridge";
import { StoreError } from "@loam/storage/storeError";

import type { EncryptionManager } from "./encryption/encryption";
import type { OpenLibrary } from "./library";
import type { Caller } from "./requests/dispatch";

/**
 * The only requests answered while encrypted notes are locked; every other
 * one, and every tool made only for AI clients, fails with LOCKED.
 */
const ALLOWED_WHILE_LOCKED: { [C in Caller]: ReadonlySet<LoamBridgeMethod> } = {
  // The unlock screen: whether notes are locked, unlocking them, and the window's theme (its
  // title bar colors and the theme files, which are not notes and are never encrypted).
  window: new Set([
    "security.status",
    "security.unlock",
    "security.resetPassphrase",
    "app.setTheme",
    "customizations.list",
  ]),
  // AI clients only learn that the notes are locked; only the user unlocks them, in the app.
  ai: new Set(["security.status"]),
};

const lockedError = () => new StoreError("Your notes are locked.", "LOCKED", 423);

/**
 * The library once it is open, and what may be asked before then: notes
 * open at launch, or after the passphrase is entered when they are encrypted.
 * Changing the library's key (turning encryption on or off, or taking the
 * sync folder's) goes through here too, so the window hears of it.
 */
export const createLibraryGate = ({
  encryption,
  open,
  onStatus,
  keyChange,
}: {
  encryption: Pick<
    EncryptionManager,
    "status" | "unlock" | "resetPassphrase" | "enable" | "disable" | "adoptSyncFolderKey"
  >;
  /** Opens the notes; called once the key is known. */
  open: () => Promise<OpenLibrary>;
  /** Tells the window that encryption changed. */
  onStatus: (status: BridgeSecurityStatus) => void;
  /**
   * What else is sealed with the library's key (the side chat's chats and
   * files): read before the key changes, and sealed with the new one after.
   */
  keyChange: { before: () => Promise<void>; after: () => Promise<void> };
}) => {
  let library: OpenLibrary | null = null;
  let opening: Promise<OpenLibrary> | null = null;

  // Encrypted notes stay locked until they are open, even once the key is known.
  const securityStatus = (): BridgeSecurityStatus =>
    library || encryption.status().state === "off" ? encryption.status() : { state: "locked" };
  const isLocked = () => securityStatus().state === "locked";

  /** Opens the notes once; a second call waits for the first. */
  const openOnce = async () => {
    opening ??= open()
      .then((opened) => (library = opened))
      .catch((error: unknown) => {
        opening = null;
        throw error;
      });
    await opening;
  };

  const unlockWith = async (unlock: () => Promise<void>) => {
    await unlock();
    await openOnce();
    onStatus(securityStatus());
    return securityStatus();
  };

  /** The open library; throws LOCKED while locked and NOT_READY while opening. */
  const requireLibrary = (): OpenLibrary => {
    if (library) return library;
    throw isLocked()
      ? lockedError()
      : new StoreError("Your notes are still opening. Try again in a moment.", "NOT_READY", 503);
  };

  /**
   * Runs `change` to the library's key, carrying what else is sealed with
   * it along, then tells the window.
   */
  const changeKey = async (change: () => Promise<void>) => {
    await keyChange.before();
    await change();
    await keyChange.after();
    onStatus(securityStatus());
  };

  return {
    securityStatus,

    /** The open library, or null while it is locked or opening. */
    current: () => library,

    library: requireLibrary,

    /** Opens unencrypted notes at launch; encrypted ones wait for `unlock`. */
    async openIfUnencrypted() {
      if (encryption.status().state === "off") await openOnce();
    },

    async unlock(passphrase: string) {
      if (!isLocked()) return securityStatus();
      return unlockWith(() => encryption.unlock(passphrase));
    },

    /** Unlocks with the recovery key and sets a new passphrase; only while locked. */
    async resetPassphrase(recoveryKey: string, passphrase: string) {
      if (!isLocked())
        throw new StoreError(
          "Your notes are already unlocked. Change the passphrase in Settings › Security.",
          "CONFLICT",
          409,
        );
      return unlockWith(() => encryption.resetPassphrase(recoveryKey, passphrase));
    },

    /** Encrypts the open library with a new key. */
    async enableEncryption(passphrase: string, recoveryKey: string) {
      await changeKey(() => encryption.enable(requireLibrary().parts, passphrase, recoveryKey));
      return securityStatus();
    },

    /** Decrypts the open library. */
    async disableEncryption(passphrase: string) {
      await changeKey(() => encryption.disable(requireLibrary().parts, passphrase));
      return securityStatus();
    },

    /** Uses the sync folder's key here too, unlocked by `secret`, then syncs. */
    async unlockSyncFolder(secret: string) {
      const { parts, sync } = requireLibrary();
      await changeKey(() => encryption.adoptSyncFolderKey(parts, secret));
      return sync.syncNow();
    },

    /**
     * Throws LOCKED unless `caller` may make `method` while the notes are
     * locked; `null` is a tool made only for AI clients.
     */
    checkAccess(method: LoamBridgeMethod | null, caller: Caller) {
      if (isLocked() && !(method && ALLOWED_WHILE_LOCKED[caller].has(method))) throw lockedError();
    },
  };
};

export type LibraryGate = ReturnType<typeof createLibraryGate>;

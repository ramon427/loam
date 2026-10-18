import { safeStorage } from "electron";

/**
 * Whether the operating system can seal a secret. On Linux without a keyring,
 * Electron's "basic_text" backend seals with a key built into Chromium,
 * which is as good as plain text.
 */
export const canSealSecrets = () =>
  safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== "basic_text";

/**
 * Secrets sealed with Electron's safeStorage, as base64, so only this user on this computer
 * can open them. `plainText` (end-to-end runs on Linux without a keyring) allows sealing
 * without one.
 */
export const createSecretBox = ({ plainText = false }: { plainText?: boolean } = {}) => ({
  canEncrypt: () => plainText || canSealSecrets(),
  seal: (plain: string) => safeStorage.encryptString(plain).toString("base64"),
  open: (sealed: string) => {
    try {
      return safeStorage.decryptString(Buffer.from(sealed, "base64"));
    } catch {
      return null;
    }
  },
});

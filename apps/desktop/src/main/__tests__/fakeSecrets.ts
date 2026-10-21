import type { SecretBox } from "../google/googleAccount";

/** Stands in for the operating system's keychain: sealed text is reversed and marked. */
export const fakeSecrets: SecretBox = {
  canEncrypt: () => true,
  seal: (plain) => `sealed:${[...plain].reverse().join("")}`,
  open: (sealed) => (sealed.startsWith("sealed:") ? [...sealed.slice(7)].reverse().join("") : null),
};

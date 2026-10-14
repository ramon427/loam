import { hkdf, randomBytes, scrypt, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

import { isRecord } from "@loam/shared/utils/isRecord";
import { UUID_PATTERN } from "@loam/shared/utils/uuid";

import { isBase64, KEY_BYTES, openBytes, sealBytes, type DataKey } from "./seal";

/**
 * A data key locked twice, so it can be stored anywhere: by a key derived
 * from the passphrase (scrypt) and by one derived from the recovery key (HKDF).
 */

/** OWASP's scrypt setting: about 128 MB and a fraction of a second per try. */
const SCRYPT = { N: 2 ** 17, r: 8, p: 1 };
/** At most about 256 MB per try, so a planted lock can't exhaust memory. */
const SCRYPT_MAX_N = 2 ** 18;
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  length: number,
  options: ScryptOptions,
) => Promise<Buffer>;
const hkdfAsync = promisify(hkdf);

type PassphraseLock = { kdf: "scrypt"; N: number; r: number; p: number; salt: string; key: string };
type RecoveryLock = { kdf: "hkdf-sha256"; salt: string; key: string };

/** A data key locked by a passphrase and by a recovery key; safe to store anywhere. */
export type KeyLocks = { keyId: string; passphrase: PassphraseLock; recovery: RecoveryLock };

const lockContext = (keyId: string, kind: "passphrase" | "recovery") => `loam-key:${keyId}:${kind}`;

const passphraseKey = (passphrase: string, lock: Omit<PassphraseLock, "key">) =>
  scryptAsync(passphrase.normalize("NFC"), Buffer.from(lock.salt, "base64"), KEY_BYTES, {
    N: lock.N,
    r: lock.r,
    p: lock.p,
    maxmem: 256 * lock.N * lock.r + 16 * 1024 * 1024,
  });

const recoveryKeyKey = async (recovery: Buffer, salt: string) =>
  Buffer.from(
    await hkdfAsync("sha256", recovery, Buffer.from(salt, "base64"), "loam recovery", KEY_BYTES),
  );

/** Crockford's base32: no I, L, O or U, so a key read aloud or retyped stays right. */
const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RECOVERY_BYTES = 20;
const RECOVERY_CHARACTERS = (RECOVERY_BYTES * 8) / 5;

const encodeBase32 = (bytes: Buffer) => {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return output;
};

/** A recovery key's bytes, or null if `input` isn't one. Spaces, dashes and case don't matter. */
export const parseRecoveryKey = (input: string): Buffer | null => {
  const characters = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (characters.length !== RECOVERY_CHARACTERS) return null;
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const character of characters) {
    const digit = BASE32.indexOf(character);
    if (digit < 0) return null;
    value = ((value << 5) | digit) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

/** A new recovery key, as the user writes it down: eight groups of four. */
export const createRecoveryKey = () =>
  encodeBase32(randomBytes(RECOVERY_BYTES)).match(/.{4}/g)!.join("-");

const lockPassphrase = async (key: DataKey, passphrase: string): Promise<PassphraseLock> => {
  const settings = { kdf: "scrypt" as const, ...SCRYPT, salt: randomBytes(16).toString("base64") };
  const wrapping = await passphraseKey(passphrase, settings);
  return {
    ...settings,
    key: sealBytes(wrapping, key.bytes, lockContext(key.id, "passphrase")).toString("base64"),
  };
};

const lockRecovery = async (key: DataKey, recoveryKey: string): Promise<RecoveryLock> => {
  const recovery = parseRecoveryKey(recoveryKey);
  if (!recovery) throw new Error("Not a recovery key.");
  const salt = randomBytes(16).toString("base64");
  const wrapping = await recoveryKeyKey(recovery, salt);
  return {
    kdf: "hkdf-sha256",
    salt,
    key: sealBytes(wrapping, key.bytes, lockContext(key.id, "recovery")).toString("base64"),
  };
};

/** Locks `key` with both secrets. */
export const lockDataKey = async (
  key: DataKey,
  { passphrase, recoveryKey }: { passphrase: string; recoveryKey: string },
): Promise<KeyLocks> => ({
  keyId: key.id,
  passphrase: await lockPassphrase(key, passphrase),
  recovery: await lockRecovery(key, recoveryKey),
});

/** The same locks with a new passphrase; the recovery key keeps working. */
export const changePassphrase = async (
  locks: KeyLocks,
  key: DataKey,
  passphrase: string,
): Promise<KeyLocks> => ({ ...locks, passphrase: await lockPassphrase(key, passphrase) });

const openLock = (
  wrapping: Buffer,
  sealed: string,
  keyId: string,
  kind: "passphrase" | "recovery",
) => {
  try {
    const bytes = openBytes(wrapping, Buffer.from(sealed, "base64"), lockContext(keyId, kind));
    return bytes.length === KEY_BYTES ? { id: keyId, bytes } : null;
  } catch {
    return null;
  }
};

/** The data key, or null when the passphrase is wrong. */
export const unlockWithPassphrase = async (locks: KeyLocks, passphrase: string) =>
  openLock(
    await passphraseKey(passphrase, locks.passphrase),
    locks.passphrase.key,
    locks.keyId,
    "passphrase",
  );

/** The data key, or null when the recovery key is wrong or isn't one. */
export const unlockWithRecoveryKey = async (locks: KeyLocks, recoveryKey: string) => {
  const recovery = parseRecoveryKey(recoveryKey);
  if (!recovery) return null;
  return openLock(
    await recoveryKeyKey(recovery, locks.recovery.salt),
    locks.recovery.key,
    locks.keyId,
    "recovery",
  );
};

/** Either secret: a recovery key when it looks like one, else a passphrase. */
export const unlockWithSecret = async (locks: KeyLocks, secret: string) =>
  (parseRecoveryKey(secret) ? await unlockWithRecoveryKey(locks, secret) : null) ??
  unlockWithPassphrase(locks, secret);

const isInteger = (value: unknown): value is number => Number.isSafeInteger(value);

/**
 * Checks key locks read from a file. Those in a sync folder or a backup are
 * untrusted: the scrypt cost is bounded, so a planted file can't make an
 * unlock use unbounded memory or time.
 */
export const readKeyLocks = (value: unknown): KeyLocks | null => {
  if (!isRecord(value)) return null;
  const { keyId, passphrase, recovery } = value;
  // Key ids are lowercase, as sealed files carry them.
  if (typeof keyId !== "string" || !UUID_PATTERN.test(keyId) || keyId !== keyId.toLowerCase())
    return null;
  if (!isRecord(passphrase) || passphrase.kdf !== "scrypt") return null;
  const { N, r, p, salt, key } = passphrase;
  if (!isBase64(salt) || !isBase64(key)) return null;
  if (!isInteger(N) || N < 2 || N > SCRYPT_MAX_N || (N & (N - 1)) !== 0) return null;
  if (!isInteger(r) || r < 1 || r > 8 || !isInteger(p) || p < 1 || p > 2) return null;
  if (!isRecord(recovery) || recovery.kdf !== "hkdf-sha256") return null;
  if (!isBase64(recovery.salt) || !isBase64(recovery.key)) return null;
  return {
    keyId,
    passphrase: { kdf: "scrypt", N, r, p, salt, key },
    recovery: { kdf: "hkdf-sha256", salt: recovery.salt, key: recovery.key },
  };
};

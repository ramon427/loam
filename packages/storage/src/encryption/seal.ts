import {
  createCipheriv,
  createDecipheriv,
  createSecretKey,
  randomBytes,
  randomUUID,
  type KeyObject,
} from "node:crypto";

import { isRecord } from "@loam/shared/utils/isRecord";

/**
 * The key everything in an encrypted library is sealed with: 256 random
 * bits, never stored as is. `encryption.json`, backups and the sync folder
 * keep it only locked by a passphrase and by a recovery key (see keyLocks).
 */
export type DataKey = { id: string; bytes: Buffer };

const IV_BYTES = 12;
const TAG_BYTES = 16;
export const KEY_BYTES = 32;

/** A sealed value failed to open: wrong key, or changed since it was sealed. */
export class SealError extends Error {}

export const createDataKey = (): DataKey => ({ id: randomUUID(), bytes: randomBytes(KEY_BYTES) });

/** Importing raw key bytes costs more than decrypting a small record, so each key is imported once. */
const keyObjects = new WeakMap<Buffer, KeyObject>();
const keyObject = (bytes: Buffer) => {
  let object = keyObjects.get(bytes);
  if (!object) {
    object = createSecretKey(bytes);
    keyObjects.set(bytes, object);
  }
  return object;
};

/**
 * AES-256-GCM: `iv | ciphertext | tag`. `context` names where the value
 * lives, so a sealed value moved somewhere else no longer opens.
 */
export const sealBytes = (key: Buffer, plain: Uint8Array, context: string) => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyObject(key), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  return Buffer.concat([iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
};

export const openBytes = (key: Buffer, sealed: Uint8Array, context: string) => {
  if (sealed.byteLength < IV_BYTES + TAG_BYTES) throw new SealError("Sealed data is too short.");
  const data = Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength);
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyObject(key), data.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(data.subarray(IV_BYTES, data.length - TAG_BYTES)),
      decipher.final(),
    ]);
  } catch (error) {
    throw new SealError("Sealed data could not be opened.", { cause: error });
  }
};

export const isBase64 = (value: unknown, maxLength = 512): value is string =>
  typeof value === "string" && value.length <= maxLength && /^[A-Za-z0-9+/]+=*$/.test(value);

// ------------------------------------------------------------ sealed values

/** A JSON value sealed with a data key. `context` says where it is stored. */
export type SealedValue = { loamSealed: string; data: string };

export const isSealedValue = (value: unknown): value is SealedValue =>
  isRecord(value) &&
  typeof value.loamSealed === "string" &&
  typeof value.data === "string" &&
  Object.keys(value).length === 2;

export const sealValue = (key: DataKey, value: unknown, context: string): SealedValue => ({
  loamSealed: key.id,
  data: sealBytes(key.bytes, Buffer.from(JSON.stringify(value), "utf8"), context).toString(
    "base64",
  ),
});

/** The value inside, with whichever of `keys` sealed it; throws SealError otherwise. */
export const openValue = (
  keys: ReadonlyArray<DataKey | null>,
  sealed: SealedValue,
  context: string,
): unknown => {
  const key = keys.find((candidate) => candidate?.id === sealed.loamSealed);
  if (!key) throw new SealError("Sealed with a key that isn't available.");
  const text = openBytes(key.bytes, Buffer.from(sealed.data, "base64"), context).toString("utf8");
  return JSON.parse(text) as unknown;
};

/** A data key sealed with another, so a re-key can resume after a crash. */
export const sealDataKey = (key: DataKey, under: DataKey): SealedValue =>
  sealValue(under, { id: key.id, bytes: key.bytes.toString("base64") }, `loam-key:${key.id}`);

export const openDataKey = (sealed: SealedValue, under: DataKey, keyId: string): DataKey => {
  const value = openValue([under], sealed, `loam-key:${keyId}`);
  if (!isRecord(value) || value.id !== keyId || !isBase64(value.bytes))
    throw new SealError("Not a data key.");
  const bytes = Buffer.from(value.bytes, "base64");
  if (bytes.length !== KEY_BYTES) throw new SealError("Not a data key.");
  return { id: keyId, bytes };
};

// ------------------------------------------------------------ sealed files

/** Sealed files start with this, then the key id (16 bytes), then the sealed bytes. */
const FILE_MAGIC = Buffer.from("LME1", "ascii");
const FILE_HEADER_BYTES = FILE_MAGIC.length + 16;

const uuidBytes = (id: string) => Buffer.from(id.replace(/-/g, ""), "hex");
const uuidFromBytes = (bytes: Buffer) => {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** The id of the key that sealed a file's bytes, or null for a plain file. */
export const sealedFileKeyId = (bytes: Uint8Array) => {
  if (bytes.byteLength < FILE_HEADER_BYTES) return null;
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!data.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) return null;
  return uuidFromBytes(data.subarray(FILE_MAGIC.length, FILE_HEADER_BYTES));
};

export const sealFile = (key: DataKey, plain: Uint8Array, context: string) =>
  Buffer.concat([FILE_MAGIC, uuidBytes(key.id), sealBytes(key.bytes, plain, context)]);

/**
 * A file's plain bytes, opened with whichever of `keys` sealed it. A plain
 * file is returned as is only when `keys` includes null (no key), so a plain
 * file put where sealed ones belong is refused.
 */
export const openFile = (
  keys: ReadonlyArray<DataKey | null>,
  bytes: Uint8Array,
  context: string,
): Buffer => {
  const keyId = sealedFileKeyId(bytes);
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!keyId) {
    if (keys.includes(null)) return data;
    throw new SealError("This file isn't sealed.");
  }
  const key = keys.find((candidate) => candidate?.id === keyId);
  if (!key) throw new SealError("Sealed with a key that isn't available.");
  return openBytes(key.bytes, data.subarray(FILE_HEADER_BYTES), context);
};

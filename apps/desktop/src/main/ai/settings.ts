import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { safeStorage } from "electron";
import { z } from "zod";

import {
  AI_ACCESS_MODES,
  AI_EFFORTS,
  AI_KEY_PROVIDER_IDS,
  AI_MODEL_ID,
  AI_PROVIDER_IDS,
  type AiChatConfigure,
  type AiKeyProviderId,
} from "@loam/shared/ai/aiChat";
import { StoreError } from "@loam/storage/storeError";

import { readJsonFile, writeJsonFile } from "../jsonFiles";
import { canSealSecrets } from "../sealedSecrets";
import { DEFAULT_MODELS } from "./providers/catalog";

const settingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(AI_PROVIDER_IDS),
  /** The model each provider last used, so switching back keeps it. */
  models: z.partialRecord(z.enum(AI_PROVIDER_IDS), z.string().regex(AI_MODEL_ID)),
  baseUrl: z.string().url().max(500).nullable(),
  defaultMode: z.enum(AI_ACCESS_MODES),
  // Settings saved before effort was a setting leave it to the model.
  effort: z.enum(AI_EFFORTS).nullable().default(null),
});
type AiSettings = z.infer<typeof settingsSchema>;

/** `record` without its empty entries, so clearing a value removes it from the file. */
const withoutEmpty = <K extends string>(record: Partial<Record<K, string | undefined>>) =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value)) as Partial<
    Record<K, string>
  >;

/** Keys sealed by the operating system's keychain, base64; never sent to the window. */
const keysSchema = z.partialRecord(z.enum(AI_KEY_PROVIDER_IDS), z.string().max(20_000));

const DEFAULT_SETTINGS: AiSettings = {
  enabled: false,
  provider: "anthropic",
  models: {},
  baseUrl: null,
  defaultMode: "auto-accept-edits",
  effort: null,
};

/**
 * The side chat's settings and API keys, in private files beside the notes
 * but outside notes, backups and sync. Keys are encrypted with Electron's
 * safeStorage, so only this user on this computer can read them.
 */
export const loadAiSettings = async (
  dataDirectory: string,
  { plainTextKeys = false }: { plainTextKeys?: boolean } = {},
) => {
  const settingsPath = join(dataDirectory, "ai.json");
  const keysPath = join(dataDirectory, "ai-keys.json");
  let settings = DEFAULT_SETTINGS;
  let keys: z.infer<typeof keysSchema> = {};
  let error: string | null = null;
  try {
    const saved = await readJsonFile(settingsPath);
    if (saved) settings = settingsSchema.parse(saved);
  } catch {
    error = "Side chat settings could not be read. Set it up again in Settings.";
  }
  try {
    keys = keysSchema.parse((await readJsonFile(keysPath)) ?? {});
  } catch {
    error = "Saved API keys could not be read. Enter them again in Settings.";
  }

  const model = () => settings.models[settings.provider] ?? DEFAULT_MODELS[settings.provider];

  return {
    current: () => settings,
    model,
    error: () => error,
    async configure(update: AiChatConfigure) {
      const { model: nextModel, ...rest } = update;
      const next = { ...settings, ...rest };
      if (nextModel !== undefined)
        next.models = withoutEmpty({ ...settings.models, [next.provider]: nextModel.trim() });
      const movedService = next.baseUrl !== settings.baseUrl;
      settings = settingsSchema.parse(next);
      await mkdir(dataDirectory, { recursive: true });
      await writeJsonFile(settingsPath, settings, { private: true });
      // A key goes only to the service it was entered for, so a new address needs it again.
      if (movedService && keys["openai-compatible"]) await this.setKey("openai-compatible", null);
      error = null;
    },
    hasKey: (provider: AiKeyProviderId) => Boolean(keys[provider]),
    /** The key in plain text, only for the request that needs it. */
    key(provider: AiKeyProviderId): string | null {
      const sealed = keys[provider];
      if (!sealed) return null;
      try {
        return safeStorage.decryptString(Buffer.from(sealed, "base64"));
      } catch {
        return null;
      }
    },
    /** The last characters of a key, so the user can tell which one is saved. */
    keyHint(provider: AiKeyProviderId) {
      const key = this.key(provider);
      return key ? key.slice(-4) : null;
    },
    async setKey(provider: AiKeyProviderId, key: string | null) {
      const trimmed = key?.trim() ?? "";
      if (trimmed && !plainTextKeys && !canSealSecrets())
        throw new StoreError(
          "This computer can't encrypt the key. Use a CLI provider instead.",
          "UNAVAILABLE",
          503,
        );
      keys = withoutEmpty({
        ...keys,
        [provider]: trimmed ? safeStorage.encryptString(trimmed).toString("base64") : "",
      });
      await mkdir(dataDirectory, { recursive: true });
      await writeJsonFile(keysPath, keys, { private: true });
    },
  };
};

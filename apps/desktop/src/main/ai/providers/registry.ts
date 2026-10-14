import type { AiKeyProviderId, AiProviderId, AiProviderStatus } from "@loam/shared/ai/aiChat";
import { StoreError } from "@loam/storage/storeError";

import type { ChatMcp } from "../chatMcp";
import type { loadAiSettings } from "../settings";
import { createAnthropicProvider } from "./anthropic";
import { PROVIDERS } from "./catalog";
import { cliVersion, findCli, type CliName } from "./cli";
import { createCliProvider } from "./cliProvider";
import { createOpenAiProvider, listOpenAiModels } from "./openai";
import type { ChatProvider } from "./types";

/**
 * The side chat's providers: which are ready (a CLI installed, a key saved),
 * the models each account offers, and a provider to run a turn with.
 */
export const createProviderRegistry = ({
  settings,
  chatMcp,
}: {
  settings: Awaited<ReturnType<typeof loadAiSettings>>;
  chatMcp: ChatMcp;
}) => {
  const clis = new Map<CliName, Promise<{ path: string; version: string | null } | null>>();
  const modelLists = new Map<AiProviderId, string[]>();

  const findInstalled = (name: CliName, refresh = false) => {
    if (refresh || !clis.has(name))
      clis.set(
        name,
        findCli(name).then(async (path) =>
          path ? { path, version: await cliVersion(path).catch(() => null) } : null,
        ),
      );
    return clis.get(name)!;
  };

  return {
    /** Loads the account's models once, so the picker can suggest them. */
    async refreshModels(provider: AiKeyProviderId) {
      const key = settings.key(provider);
      if (!key || provider === "anthropic") return;
      try {
        const baseUrl = provider === "openai" ? null : settings.current().baseUrl;
        if (provider === "openai-compatible" && !baseUrl) return;
        const models = await listOpenAiModels(key, baseUrl);
        modelLists.set(provider, models);
        // A provider without a chosen model starts with the newest.
        if (
          !settings.current().models[provider] &&
          models[0] &&
          settings.current().provider === provider
        )
          await settings.configure({ model: models[0] });
      } catch {
        modelLists.delete(provider);
      }
    },

    /** Forgets the models loaded for `provider`, whose key or address changed. */
    forgetModels(provider: AiProviderId) {
      modelLists.delete(provider);
    },

    async status(id: AiProviderId): Promise<AiProviderStatus> {
      const { label, kind, models, experimental } = PROVIDERS[id];
      const base = { id, label, kind, models: modelLists.get(id) ?? models, experimental };
      if (kind === "cli") {
        const cli = await findInstalled(id === "claude-cli" ? "claude" : "codex");
        return {
          ...base,
          ready: Boolean(cli),
          detail: cli ? (cli.version ?? "Installed") : "Not installed on this computer",
        };
      }
      const keyId = id as AiKeyProviderId;
      const hint = settings.keyHint(keyId);
      const needsUrl = id === "openai-compatible" && !settings.current().baseUrl;
      return {
        ...base,
        ready: Boolean(hint) && !needsUrl,
        detail: hint ? `Key ending in ${hint}` : "No key saved",
      };
    },

    /** The provider to run a turn with; fails when it isn't installed or set up. */
    async providerFor(id: AiProviderId): Promise<ChatProvider> {
      if (id === "claude-cli" || id === "codex-cli") {
        const name = id === "claude-cli" ? "claude" : "codex";
        const cli = await findInstalled(name, true);
        if (!cli)
          throw new StoreError(
            `${name === "claude" ? "Claude Code" : "Codex"} isn't installed on this computer.`,
            "NOT_FOUND",
            404,
          );
        return createCliProvider({ name, path: cli.path, chatMcp });
      }
      const key = settings.key(id);
      if (!key) throw new StoreError("Add an API key in Settings › Side chat.", "FORBIDDEN", 403);
      if (id === "anthropic") return createAnthropicProvider(key);
      const baseUrl = id === "openai" ? null : settings.current().baseUrl;
      if (id === "openai-compatible" && !baseUrl)
        throw new StoreError(
          "Add the service's base URL in Settings › Side chat.",
          "FORBIDDEN",
          403,
        );
      return createOpenAiProvider({ provider: id, apiKey: key, baseUrl });
    },
  };
};

export type ProviderRegistry = ReturnType<typeof createProviderRegistry>;

import type { AiProviderId } from "@loam/shared/ai/aiChat";

/** How each provider is named and reached, and the models suggested for it. */
export const PROVIDERS: Record<
  AiProviderId,
  { label: string; kind: "api-key" | "cli"; models: string[]; experimental: boolean }
> = {
  anthropic: {
    label: "Anthropic API",
    kind: "api-key",
    models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
    experimental: false,
  },
  openai: {
    label: "OpenAI API",
    kind: "api-key",
    // Filled from the account's model list once a key is saved.
    models: [],
    experimental: false,
  },
  "openai-compatible": {
    label: "OpenAI-compatible API",
    kind: "api-key",
    models: [],
    experimental: false,
  },
  "claude-cli": {
    label: "Claude Code (your sign-in)",
    kind: "cli",
    models: ["opus", "sonnet", "haiku"],
    experimental: true,
  },
  "codex-cli": {
    label: "Codex (your sign-in)",
    kind: "cli",
    models: [],
    experimental: true,
  },
};

/**
 * The model a provider starts with. Empty lets a CLI use its own default; for
 * an API it is picked from the account's models once a key is saved.
 */
export const DEFAULT_MODELS: Record<AiProviderId, string> = {
  anthropic: "claude-opus-5-5",
  openai: "",
  "openai-compatible": "",
  "claude-cli": "",
  "codex-cli": "",
};

/**
 * How many tokens a model's context holds, where it is known: Claude's
 * current models hold a million, Haiku 4.5 and older Claude models 200,000.
 * Other providers' models vary; null leaves the chat showing only a count.
 */
export const contextWindowOf = (provider: AiProviderId, model: string) => {
  if (provider !== "anthropic") return null;
  return /haiku-4|claude-3|sonnet-4-5|opus-4-5|opus-4-1|opus-4-0|sonnet-4-0/.test(model)
    ? 200_000
    : 1_000_000;
};

import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  AI_ACCESS_MODES,
  type AiAccessMode,
  type AiChatConfigure,
  type AiKeyProviderId,
  type AiProviderId,
  type AiProviderStatus,
} from "@loam/shared/ai/aiChat";

import { ACCESS_MODES } from "../ai/accessModes";
import { callBridge } from "../bridge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/Select";

import { QUERY_KEYS, useAiChatStatus } from "./queries";
import {
  SettingsNote,
  SettingsNotice,
  SettingsRow,
  SettingsSection,
  useSettingsBusy,
} from "./SettingsLayout";

const providerName = (provider: AiProviderStatus) =>
  provider.experimental ? `${provider.label} (experimental)` : provider.label;

const providerState = (provider: AiProviderStatus) => {
  if (provider.ready) return provider.detail ? `Ready: ${provider.detail}` : "Ready";
  return provider.detail ?? (provider.kind === "api-key" ? "Add an API key." : "Not found.");
};

/** Turns the side chat on or off and picks where its replies come from. */
export function AiChatSettings() {
  const queryClient = useQueryClient();
  const status = useAiChatStatus();
  const modelListId = useId();
  const [modelDraft, setModelDraft] = useState<string | null>(null);
  const [baseUrlDraft, setBaseUrlDraft] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const configure = useMutation({
    mutationFn: (change: AiChatConfigure) => callBridge("ai.configure", change),
    onSuccess: (next) => queryClient.setQueryData(QUERY_KEYS.aiChatStatus, next),
    onSettled: () => {
      setModelDraft(null);
      setBaseUrlDraft(null);
    },
  });
  const setKey = useMutation({
    mutationFn: (change: { provider: AiKeyProviderId; key: string | null }) =>
      callBridge("ai.setKey", change),
    onSuccess: (next) => {
      queryClient.setQueryData(QUERY_KEYS.aiChatStatus, next);
      setKeyDraft("");
    },
  });
  const busy = configure.isPending || setKey.isPending;
  useSettingsBusy(busy);
  const data = status.data;
  const provider = data?.providers.find((candidate) => candidate.id === data.provider);
  const failure = configure.error ?? setKey.error ?? status.error;
  const model = modelDraft ?? data?.model ?? "";
  const baseUrl = baseUrlDraft ?? data?.baseUrl ?? "";

  const saveModel = () => {
    const next = model.trim();
    if (modelDraft === null || !data || next === data.model) setModelDraft(null);
    else configure.mutate({ model: next });
  };
  const saveBaseUrl = () => {
    const next = baseUrl.trim() || null;
    if (baseUrlDraft === null || !data || next === data.baseUrl) setBaseUrlDraft(null);
    else configure.mutate({ baseUrl: next });
  };

  return (
    <SettingsSection description="Chat with an AI that can read and edit your notes. Off by default; use AI access instead if you prefer your own MCP client.">
      {failure ? <SettingsNotice tone="danger">{failure.message}</SettingsNotice> : null}
      {data?.error ? <SettingsNotice tone="danger">{data.error}</SettingsNotice> : null}
      <SettingsRow
        title="Side chat"
        description={data ? (data.enabled ? "On" : "Off") : "Loading…"}
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={!data || busy}
            onClick={() => configure.mutate({ enabled: !data?.enabled })}
          >
            {data?.enabled ? "Turn off side chat" : "Turn on side chat"}
          </Button>
        }
      />
      {data && provider ? (
        <>
          <SettingsRow
            title="Provider"
            description={<span data-testid="ai-provider-state">{providerState(provider)}</span>}
            control={
              <Select
                value={data.provider}
                disabled={busy}
                onValueChange={(value) => configure.mutate({ provider: value as AiProviderId })}
              >
                <SelectTrigger aria-label="Provider" className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {data.providers.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {providerName(candidate)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="Model"
            control={
              <>
                <Input
                  aria-label="Model"
                  className="w-64"
                  list={modelListId}
                  value={model}
                  disabled={busy}
                  placeholder={provider.models[0]}
                  onChange={(event) => setModelDraft(event.target.value)}
                  onBlur={saveModel}
                />
                <datalist id={modelListId}>
                  {provider.models.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </>
            }
          />
          {provider.id === "openai-compatible" ? (
            <SettingsRow
              title="Base URL"
              description="The address of a service with OpenAI's API, such as OpenRouter or Ollama."
              control={
                <Input
                  aria-label="Base URL"
                  className="w-64"
                  value={baseUrl}
                  disabled={busy}
                  placeholder="https://openrouter.ai/api/v1"
                  onChange={(event) => setBaseUrlDraft(event.target.value)}
                  onBlur={saveBaseUrl}
                />
              }
            />
          ) : null}
          {provider.kind === "api-key" ? (
            <SettingsRow
              title="API key"
              control={
                <>
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const key = keyDraft.trim();
                      if (key)
                        setKey.mutate({
                          provider: provider.id as AiKeyProviderId,
                          key: keyDraft.trim(),
                        });
                    }}
                  >
                    <Input
                      aria-label="API key"
                      type="password"
                      autoComplete="off"
                      className="w-48"
                      value={keyDraft}
                      disabled={busy}
                      placeholder={provider.ready ? "Replace the saved key" : "Paste a key"}
                      onChange={(event) => setKeyDraft(event.target.value)}
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      disabled={busy || !keyDraft.trim()}
                    >
                      Save key
                    </Button>
                  </form>
                  {provider.ready ? (
                    <Button
                      size="sm"
                      variant="ghost-destructive"
                      disabled={busy}
                      onClick={() =>
                        setKey.mutate({ provider: provider.id as AiKeyProviderId, key: null })
                      }
                    >
                      Remove key
                    </Button>
                  ) : null}
                </>
              }
            />
          ) : null}
          <SettingsRow
            title="New chats start in"
            description={ACCESS_MODES[data.defaultMode].description}
            control={
              <Select
                value={data.defaultMode}
                disabled={busy}
                onValueChange={(value) => configure.mutate({ defaultMode: value as AiAccessMode })}
              >
                <SelectTrigger aria-label="New chats start in" className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AI_ACCESS_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {ACCESS_MODES[mode].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          {provider.kind === "cli" ? (
            <SettingsNote>
              Runs the {provider.id === "claude-cli" ? "claude" : "codex"} command installed on this
              computer, signed in with your own account, from your home folder. Besides your notes,
              the web and Loam&apos;s browser, it can read your files and run commands, as the
              chat&apos;s access mode allows.{" "}
              {provider.id === "codex-cli"
                ? "Codex can't stop to ask, so Supervised keeps it from changing anything. "
                : null}
              Whether your subscription may be used this way is up to the provider&apos;s terms.
            </SettingsNote>
          ) : (
            <SettingsNote>
              Keys are encrypted by your operating system and stay on this computer, outside sync
              and backups. What you send goes to the provider you pick. The assistant can read your
              notes, search the web and use Loam&apos;s browser window.
            </SettingsNote>
          )}
        </>
      ) : null}
    </SettingsSection>
  );
}

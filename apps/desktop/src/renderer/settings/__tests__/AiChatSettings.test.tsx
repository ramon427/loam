// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AiChatStatus } from "@loam/shared/ai/aiChat";

import { installFakeBridge } from "../../testing/fakeBridge";
import { AiChatSettings } from "../AiChatSettings";

const STATUS: AiChatStatus = {
  enabled: false,
  provider: "anthropic",
  model: "claude-sonnet",
  baseUrl: null,
  defaultMode: "supervised",
  effort: null,
  canDictate: false,
  providers: [
    {
      id: "anthropic",
      label: "Anthropic",
      kind: "api-key",
      ready: false,
      detail: null,
      models: ["claude-sonnet"],
      experimental: false,
    },
    {
      id: "claude-cli",
      label: "Claude Code",
      kind: "cli",
      ready: true,
      detail: "claude 2.1.0",
      models: [],
      experimental: true,
    },
  ],
  error: null,
};

const renderSettings = (status: AiChatStatus = STATUS) => {
  const bridge = installFakeBridge({
    "ai.status": () => status,
    "ai.configure": (change: Partial<AiChatStatus>) => ({ ...status, ...change }),
    "ai.setKey": () => ({
      ...status,
      providers: status.providers.map((provider) =>
        provider.id === "anthropic"
          ? { ...provider, ready: true, detail: "Key ending in 4f2a" }
          : provider,
      ),
    }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AiChatSettings />
    </QueryClientProvider>,
  );
  return bridge;
};

describe("AiChatSettings", () => {
  it("turns the side chat on", async () => {
    const { invoke } = renderSettings();
    await screen.findByText("Off");
    fireEvent.click(screen.getByRole("button", { name: "Turn on side chat" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("ai.configure", { enabled: true }));
    expect(await screen.findByRole("button", { name: "Turn off side chat" })).toBeTruthy();
  });

  it("saves an API key without showing it again", async () => {
    const { invoke } = renderSettings();
    const field = await screen.findByLabelText("API key");
    fireEvent.change(field, { target: { value: "sk-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("ai.setKey", { provider: "anthropic", key: "sk-secret" }),
    );
    expect(await screen.findByText("Ready: Key ending in 4f2a")).toBeTruthy();
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Remove key" })).toBeTruthy();
  });

  it("saves the model when the field is left", async () => {
    const { invoke } = renderSettings();
    const field = await screen.findByLabelText("Model");
    fireEvent.change(field, { target: { value: "claude-opus" } });
    fireEvent.blur(field);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("ai.configure", { model: "claude-opus" }),
    );
  });

  it("explains what a CLI provider runs", async () => {
    renderSettings({ ...STATUS, provider: "claude-cli" });
    expect(
      await screen.findByText(/Runs the claude command installed on this computer/),
    ).toBeTruthy();
    expect(screen.queryByLabelText("API key")).toBeNull();
  });
});

// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BridgeUpdateStatus } from "@loam/shared/bridge/loamBridge";

import { installFakeBridge } from "../../testing/fakeBridge";

const toasts = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("../../ui/toast", () => toasts);

import { UpdateSettings } from "../UpdateSettings";

const IDLE: BridgeUpdateStatus = {
  state: "idle",
  version: null,
  progress: null,
  lastCheckedAt: null,
  error: null,
  releaseNotes: [],
  omittedReleaseCount: 0,
};
const READY: BridgeUpdateStatus = { ...IDLE, state: "ready", version: "0.2.0" };

const renderUpdates = (
  initial: BridgeUpdateStatus,
  handlers: Parameters<typeof installFakeBridge>[0] = {},
) => {
  const { invoke, emit } = installFakeBridge({
    "app.info": () => ({ version: "0.1.0", storageAdapter: "sqlite", dataDirectory: "" }),
    "updates.status": () => initial,
    "updates.check": () => ({ ...IDLE, lastCheckedAt: Date.UTC(2026, 9, 11, 9) }),
    ...handlers,
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UpdateSettings />
    </QueryClientProvider>,
  );
  return { invoke, pushStatus: (status: BridgeUpdateStatus) => emit("updates.status", status) };
};

afterEach(() => {
  toasts.toastError.mockReset();
});

describe("UpdateSettings", () => {
  it("shows the version and checks for updates", async () => {
    const { invoke } = renderUpdates(IDLE);
    expect(await screen.findByText("0.1.0")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: /Check for updates/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("updates.check", {}));
    await waitFor(() =>
      expect(screen.getByTestId("settings-update-status").textContent).toMatch(/^Up to date/),
    );
  });

  it("says when checking for updates fails", async () => {
    renderUpdates(IDLE, {
      "updates.check": () => {
        throw new Error("The update server can't be reached.");
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Check for updates/ }));
    await waitFor(() =>
      expect(toasts.toastError).toHaveBeenCalledWith("Could not check for updates", {
        description: "The update server can't be reached.",
      }),
    );
  });

  it("follows a download and restarts into the update", async () => {
    const { invoke, pushStatus } = renderUpdates(IDLE);
    await screen.findByRole("button", { name: /Check for updates/ });

    act(() => pushStatus({ ...IDLE, state: "downloading", version: "0.2.0", progress: 40 }));
    await waitFor(() =>
      expect(screen.getByTestId("settings-update-status").textContent).toBe(
        "Downloading 0.2.0… 40%",
      ),
    );

    act(() => pushStatus(READY));
    fireEvent.click(await screen.findByRole("button", { name: /Restart to update/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("updates.install", {}));
  });

  it("links to the download where Loam can't install an update", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    document.documentElement.dataset.platform = "darwin";
    try {
      const { invoke } = renderUpdates({ ...IDLE, state: "available", version: "0.2.0" });
      expect(await screen.findByText(/download it from GitHub and replace/)).toBeTruthy();
      await waitFor(() =>
        expect(screen.getByTestId("settings-update-status").textContent).toBe(
          "Version 0.2.0 is out. Download it from GitHub to install it.",
        ),
      );
      fireEvent.click(screen.getByRole("button", { name: /Download/ }));
      expect(open).toHaveBeenCalledWith(
        "https://github.com/ramon427/loam/releases/tag/v0.2.0",
        "_blank",
        "noopener",
      );
      expect(invoke).not.toHaveBeenCalledWith("updates.install", {});
    } finally {
      delete document.documentElement.dataset.platform;
    }
  });

  it("shows why updates failed", async () => {
    renderUpdates({ ...IDLE, state: "error", error: "Could not check for updates." });
    expect((await screen.findByRole("alert")).textContent).toBe("Could not check for updates.");
  });

  it("has nothing to check in a copy that can't update itself", async () => {
    renderUpdates({ ...IDLE, state: "unavailable" });
    expect(await screen.findByText(/doesn't update itself/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

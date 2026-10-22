// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BridgeSyncStatus } from "@loam/shared/bridge/loamBridge";

import { installFakeBridge } from "@loam/notes-ui/testing/fakeBridge";

const toasts = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("@loam/notes-ui/ui/toast", () => toasts);

import { SyncSettings } from "../SyncSettings";

const OFF: BridgeSyncStatus = {
  folder: null,
  server: null,
  state: "off",
  lastSyncedAt: null,
  error: null,
  unpublished: 0,
  needsPassphrase: false,
};
const ON: BridgeSyncStatus = {
  folder: "/home/me/Dropbox/Notes",
  server: null,
  state: "synced",
  lastSyncedAt: Date.UTC(2026, 9, 11, 9),
  error: null,
  unpublished: 0,
  needsPassphrase: false,
};

const renderSync = (
  initial: BridgeSyncStatus,
  handlers: Parameters<typeof installFakeBridge>[0] = {},
) => {
  const { invoke, emit } = installFakeBridge({
    "sync.status": () => initial,
    "sync.chooseFolder": () => ({ status: "chosen", sync: ON }),
    "sync.turnOff": () => OFF,
    "sync.now": () => ON,
    "sync.unlockFolder": () => ON,
    ...handlers,
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SyncSettings />
    </QueryClientProvider>,
  );
  return { invoke, pushStatus: (status: BridgeSyncStatus) => emit("sync.status", status) };
};

afterEach(() => {
  toasts.toastError.mockReset();
});

describe("SyncSettings", () => {
  it("starts syncing through a chosen folder", async () => {
    const { invoke } = renderSync(OFF);
    expect(await screen.findByText("Off")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Choose folder/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("sync.chooseFolder", {}));
    expect(await screen.findByText("/home/me/Dropbox/Notes")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/^Synced /);
  });

  it("follows status updates from the background, and shows why a sync failed", async () => {
    const { pushStatus } = renderSync(ON);
    await screen.findByText("/home/me/Dropbox/Notes");
    act(() => pushStatus({ ...ON, state: "syncing", unpublished: 3 }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Syncing… · 3 changes to send"),
    );
    act(() =>
      pushStatus({ ...ON, state: "error", error: "Can't reach the sync folder (EACCES)." }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain("Can't reach the sync folder");
  });

  it("starts syncing through a sync server with its code", async () => {
    const code = `https://loam-sync.me.workers.dev/#${"k".repeat(43)}`;
    const { invoke } = renderSync(OFF, {
      "sync.useServer": () => ({ ...ON, folder: null, server: "loam-sync.me.workers.dev" }),
    });
    fireEvent.change(await screen.findByLabelText("Sync code"), { target: { value: code } });
    fireEvent.click(screen.getByRole("button", { name: /Connect/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("sync.useServer", { code }));
    expect(await screen.findByText("loam-sync.me.workers.dev")).toBeTruthy();
    expect(screen.getByText("Not used")).toBeTruthy();
    expect((screen.getByLabelText("Sync code") as HTMLInputElement).value).toBe("");
  });

  it("syncs now and turns sync off", async () => {
    const { invoke } = renderSync(ON);
    fireEvent.click(await screen.findByRole("button", { name: /Sync now/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("sync.now", {}));
    fireEvent.click(screen.getByRole("button", { name: "Turn off sync" }));
    expect(await screen.findByText("Off")).toBeTruthy();
  });

  it("says when syncing now fails", async () => {
    renderSync(ON, {
      "sync.now": () => {
        throw new Error("The sync folder is offline.");
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Sync now/ }));
    await waitFor(() =>
      expect(toasts.toastError).toHaveBeenCalledWith("Sync failed", {
        description: "The sync folder is offline.",
      }),
    );
  });

  it("asks for the passphrase of an encrypted sync folder", async () => {
    const { invoke } = renderSync({
      ...ON,
      state: "error",
      error: "The notes in this sync folder are encrypted. Enter their passphrase to sync.",
      needsPassphrase: true,
    });
    const field = await screen.findByLabelText("Passphrase or recovery key");
    fireEvent.change(field, { target: { value: "folder passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: /Unlock and sync/ }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("sync.unlockFolder", { secret: "folder passphrase" }),
    );
    await waitFor(() => expect(screen.queryByLabelText("Passphrase or recovery key")).toBeNull());
  });
});

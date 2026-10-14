// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BridgeBackupList } from "@loam/shared/bridge/loamBridge";

const waitMock = vi.hoisted(() => ({ saved: true }));
vi.mock("../../workspace/saveAllNoteEdits", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  saveAllNoteEdits: async () => waitMock.saved,
}));

const toasts = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("../../ui/toast", () => toasts);

import { BridgeError } from "../../bridge";
import { installFakeBridge } from "../../testing/fakeBridge";
import { BackupSettings } from "../BackupSettings";

const list: BridgeBackupList = {
  directory: "/home/me/Loam data/backups",
  lastError: null,
  backups: [
    { id: "b2", createdAt: Date.UTC(2026, 9, 10, 9), kind: "before-import", sizeBytes: 2048 },
    { id: "b1", createdAt: Date.UTC(2026, 9, 9, 9), kind: "auto", sizeBytes: 3 * 1024 * 1024 },
  ],
};

/** Renders the section over `list` with `overrides`; `handlers` replace the bridge's answers. */
const renderBackups = (
  overrides: Partial<BridgeBackupList> = {},
  handlers: Parameters<typeof installFakeBridge>[0] = {},
) => {
  const { invoke } = installFakeBridge({
    "backups.list": () => ({ ...list, ...overrides }),
    "backups.restore": ({ backupId, secret }: { backupId: string; secret?: string }) => {
      if (backupId === "b2" && secret !== "old passphrase")
        throw new BridgeError("That backup is encrypted with another passphrase.", "BACKUP_LOCKED");
      return { createdAt: 0 };
    },
    "backups.restoreFile": () => ({ status: "canceled" }),
    ...handlers,
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BackupSettings />
    </QueryClientProvider>,
  );
  return { invoke };
};

afterEach(() => {
  waitMock.saved = true;
  vi.clearAllMocks();
});

describe("BackupSettings", () => {
  it("lists backups, newest first, with the last scheduled one on top", async () => {
    renderBackups();
    const items = within(await screen.findByRole("list", { name: "Backups" })).getAllByRole(
      "listitem",
    );
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Before an import · 2 KB"),
      expect.stringContaining("Daily · 3.0 MB"),
    ]);
    expect(screen.getByText("/home/me/Loam data/backups")).toBeTruthy();
  });

  it("backs up now and opens the folder", async () => {
    const { invoke } = renderBackups();
    fireEvent.click(await screen.findByRole("button", { name: /Back up now/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("backups.create", {}));
    fireEvent.click(screen.getByText("Backup details"));
    fireEvent.click(screen.getByRole("button", { name: /Open folder/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("backups.openFolder", {}));
  });

  it("says when the backups folder can't be opened", async () => {
    renderBackups(
      {},
      {
        "backups.openFolder": () => {
          throw new Error("No file manager.");
        },
      },
    );
    fireEvent.click(await screen.findByText("Backup details"));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /Open folder/ }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: /Open folder/ }));
    await waitFor(() =>
      expect(toasts.toastError).toHaveBeenCalledWith("Could not open the backups folder", {
        description: "No file manager.",
      }),
    );
  });

  it("restores a backup only after confirming", async () => {
    const { invoke } = renderBackups();
    const items = within(await screen.findByRole("list", { name: "Backups" })).getAllByRole(
      "listitem",
    );
    fireEvent.click(within(items[1]!).getByRole("button", { name: /Restore/ }));
    expect(invoke).not.toHaveBeenCalledWith("backups.restore", expect.anything());

    const dialog = await screen.findByRole("dialog", { name: "Restore this backup?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("backups.restore", { backupId: "b1" }));
    expect(await screen.findByText(/restarts in a moment/)).toBeTruthy();
  });

  it("does not restore while edits are unsaved", async () => {
    waitMock.saved = false;
    const { invoke } = renderBackups();
    fireEvent.click(await screen.findByRole("button", { name: /Restore from a file/ }));
    await waitFor(() => expect(screen.queryByText(/restarts in a moment/)).toBeNull());
    expect(invoke).not.toHaveBeenCalledWith("backups.restoreFile", expect.anything());
  });

  it("shows why the last backup failed", async () => {
    renderBackups({ lastError: "ENOSPC: no space left on device" });
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "The last backup failed: ENOSPC: no space left on device",
    );
  });

  it("asks for the passphrase of a backup encrypted with another one", async () => {
    const { invoke } = renderBackups();
    const items = within(await screen.findByRole("list", { name: "Backups" })).getAllByRole(
      "listitem",
    );
    fireEvent.click(within(items[0]!).getByRole("button", { name: /Restore/ }));
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    const field = await screen.findByLabelText("Passphrase or recovery key");
    expect(screen.getByText("That backup is encrypted with another passphrase.")).toBeTruthy();
    fireEvent.change(field, { target: { value: "old passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("backups.restore", {
        backupId: "b2",
        secret: "old passphrase",
      }),
    );
  });
});

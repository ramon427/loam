// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KeyboardShortcutsScope, useShortcuts } from "../../keyboard/useShortcuts";
import { installFakeBridge } from "../../testing/fakeBridge";

import { SettingsButton, SettingsScreen } from "../SettingsScreen";

const appInfo = { version: "0.1.0", storageAdapter: "sqlite", dataDirectory: "/home/me/Loam data" };

const noteShortcut = vi.fn();

function EditorShortcuts() {
  useShortcuts([{ id: "entry.close", run: noteShortcut }]);
  return null;
}

function SettingsHarness() {
  const [open, setOpen] = useState(false);
  const shortcuts = useMemo(() => [{ id: "app.settings" as const, run: () => setOpen(true) }], []);
  useShortcuts(shortcuts);
  return (
    <>
      <SettingsButton onOpen={() => setOpen(true)} />
      <KeyboardShortcutsScope enabled={!open}>
        <EditorShortcuts />
      </KeyboardShortcutsScope>
      <SettingsScreen open={open} onClose={() => setOpen(false)} />
    </>
  );
}

const renderSettings = (backupRequest: () => Promise<unknown> = async () => null) => {
  const { invoke } = installFakeBridge({
    "app.info": () => appInfo,
    "security.status": () => ({ state: "off" }),
    "backups.list": () => ({ backups: [], directory: "/backups", lastError: null }),
    "backups.create": backupRequest,
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsHarness />
    </QueryClientProvider>,
  );
  return { invoke };
};

afterEach(() => {
  noteShortcut.mockClear();
});

describe("SettingsScreen", () => {
  it("opens a workspace screen with the data folder and expandable storage details", async () => {
    const { invoke } = renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(await screen.findByText("/home/me/Loam data")).toBeTruthy();
    expect(screen.getByRole("main", { name: "Settings" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    const details = screen.getByRole("button", { name: "Storage details" });
    expect(details.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(details);
    expect(details.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("settings-storage-adapter").textContent).toBe("sqlite");

    fireEvent.click(screen.getByRole("button", { name: /Open data folder/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("app.openDataDirectory", {}));
  });

  it("opens with Ctrl+, even while typing in an editor", async () => {
    renderSettings();
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    document.body.append(editor);

    fireEvent.keyDown(editor, { key: ",", code: "Comma", ctrlKey: true });

    expect(await screen.findByRole("main", { name: "Settings" })).toBeTruthy();
    editor.remove();
  });

  it("finds settings by topic and opens a result with the keyboard", async () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const search = screen.getByRole("combobox", { name: "Search settings" });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: "password" } });
    expect(screen.getByRole("option", { name: /Security/ }).getAttribute("aria-selected")).toBe(
      "true",
    );
    fireEvent.keyDown(search, { key: "Enter" });
    expect(await screen.findByRole("heading", { name: "Security" })).toBeTruthy();
    expect((search as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Security" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("clears search before returning to notes, and remembers the selected section", async () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Backups" }));
    const search = screen.getByRole("combobox", { name: "Search settings" });
    fireEvent.change(search, { target: { value: "something unavailable" } });
    expect(screen.getByRole("status").textContent).toContain("No settings found");
    fireEvent.keyDown(search, { key: "Escape" });
    expect((search as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("main", { name: "Settings" })).toBeTruthy();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("main", { name: "Settings" })).toBeNull();
    expect(noteShortcut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Backups" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Back to notes/ }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(noteShortcut).toHaveBeenCalledTimes(1);
  });

  it("keeps the active section open until a backup finishes", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    renderSettings(() => pending);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Backups" }));
    fireEvent.click(await screen.findByRole("button", { name: /Back up now/ }));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /Back to notes/ }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Data" }));
    expect(screen.getByRole("heading", { name: "Backups" })).toBeTruthy();
    expect(noteShortcut).not.toHaveBeenCalled();
    await act(async () => {
      finish();
      await pending;
    });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /Back to notes/ }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("main", { name: "Settings" })).toBeNull();
  });
});

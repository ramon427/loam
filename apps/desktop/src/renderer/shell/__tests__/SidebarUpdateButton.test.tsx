// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BridgeUpdateStatus } from "@loam/shared/bridge/loamBridge";

import { installFakeBridge } from "../../testing/fakeBridge";
import { SidebarUpdateButton } from "../SidebarUpdateButton";

const IDLE: BridgeUpdateStatus = {
  state: "idle",
  version: null,
  progress: null,
  lastCheckedAt: null,
  error: null,
  releaseNotes: [],
  omittedReleaseCount: 0,
};
const READY: BridgeUpdateStatus = {
  ...IDLE,
  state: "ready",
  version: "0.3.1",
  releaseNotes: [{ version: "0.3.1", items: ["Faster search"], totalItems: 3 }],
};

const renderButton = (initial: BridgeUpdateStatus) => {
  const { invoke, emit } = installFakeBridge({
    "updates.status": () => initial,
    "updates.check": () => ({ ...IDLE, state: "checking" }),
    "updates.install": () => undefined,
  });
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <SidebarUpdateButton />
    </QueryClientProvider>,
  );
  return {
    container,
    invoke,
    pushStatus: (status: BridgeUpdateStatus) => act(() => emit("updates.status", status)),
  };
};

describe("SidebarUpdateButton", () => {
  it("checks for updates when clicked, spinning while it checks", async () => {
    const { invoke } = renderButton(IDLE);
    fireEvent.click(await screen.findByRole("button", { name: "Check for updates" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("updates.check", {}));
    const checking = await screen.findByRole("button", { name: "Checking for updates…" });
    expect(checking.querySelector("svg")?.getAttribute("class")).toContain("animate-spin");
  });

  it("shows a download's progress, then restarts into the update", async () => {
    const { invoke, pushStatus } = renderButton(IDLE);
    await screen.findByRole("button", { name: "Check for updates" });

    pushStatus({ ...IDLE, state: "downloading", version: "0.3.1", progress: 40 });
    const downloading = await screen.findByRole("button", { name: "Downloading 0.3.1… 40%" });
    // Clicking mid-download neither checks again nor installs.
    fireEvent.click(downloading);
    expect(invoke).not.toHaveBeenCalledWith("updates.check", {});
    expect(invoke).not.toHaveBeenCalledWith("updates.install", {});

    pushStatus(READY);
    const ready = await screen.findByRole("button", { name: "Restart to install version 0.3.1" });
    expect(ready.textContent).toBe("");
    fireEvent.click(ready);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("updates.install", {}));
  });

  it("shows what changed when hovered", async () => {
    renderButton(READY);
    fireEvent.pointerEnter(await screen.findByTestId("sidebar-update-button"));
    expect(await screen.findByText("Faster search")).toBeTruthy();
    expect(screen.getByText("What's changed")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /2 more changes on GitHub/ }).getAttribute("href"),
    ).toBe("https://github.com/ramon427/loam/releases/tag/v0.3.1");
  });

  it("says why the last check failed and checks again when clicked", async () => {
    const { invoke } = renderButton({
      ...IDLE,
      state: "error",
      error: "Could not check for updates.",
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Could not check for updates. Check again" }),
    );
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("updates.check", {}));
  });

  it("shows nothing in a copy that doesn't update itself", async () => {
    const { container, invoke } = renderButton({ ...IDLE, state: "unavailable" });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("updates.status", {}));
    expect(container.querySelector("button")).toBeNull();
  });
});

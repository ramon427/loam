// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { installFakeBridge } from "../../testing/fakeBridge";

const toasts = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("../../ui/toast", () => toasts);

import { DataSettings } from "../DataSettings";

describe("DataSettings", () => {
  it("shows the data folder and says when it can't be opened", async () => {
    const { invoke } = installFakeBridge({
      "app.info": () => ({ version: "0.2.0", storageAdapter: "sqlite", dataDirectory: "/data" }),
      "app.openDataDirectory": () => {
        throw new Error("No file manager.");
      },
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DataSettings />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("settings-data-folder").textContent).toBe("/data"),
    );
    fireEvent.click(screen.getByRole("button", { name: /Open data folder/ }));
    await waitFor(() =>
      expect(toasts.toastError).toHaveBeenCalledWith("Could not open the data folder", {
        description: "No file manager.",
      }),
    );
    expect(invoke).toHaveBeenCalledWith("app.openDataDirectory", {});
  });
});

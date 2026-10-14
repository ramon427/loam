// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BridgeSecurityStatus } from "@loam/shared/bridge/loamBridge";

import { BridgeError } from "../../bridge";
import { installFakeBridge } from "../../testing/fakeBridge";

vi.mock("../../shell/TitleBar", () => ({ TitleBar: () => null }));

import { UnlockGate } from "../UnlockGate";

const renderGate = (initial: BridgeSecurityStatus["state"]) => {
  const { invoke } = installFakeBridge({
    "security.status": () => ({ state: initial }),
    "security.unlock": ({ passphrase }: { passphrase: string }) => {
      if (passphrase !== "right passphrase")
        throw new BridgeError("That passphrase isn't right.", "WRONG_PASSPHRASE");
      return { state: "on" };
    },
    "security.resetPassphrase": () => ({ state: "on" }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UnlockGate>
        <p>The notes</p>
      </UnlockGate>
    </QueryClientProvider>,
  );
  return { invoke };
};

describe("UnlockGate", () => {
  it("shows the notes straight away when they aren't encrypted", async () => {
    renderGate("off");
    expect(await screen.findByText("The notes")).toBeTruthy();
  });

  it("asks for the passphrase, says when it is wrong, and opens the notes with the right one", async () => {
    const { invoke } = renderGate("locked");
    const field = await screen.findByLabelText("Passphrase");
    expect(screen.queryByText("The notes")).toBeNull();
    fireEvent.change(field, { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That passphrase isn't right.");
    expect((field as HTMLInputElement).value).toBe("");
    fireEvent.change(field, { target: { value: "right passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("The notes")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("security.unlock", { passphrase: "right passphrase" });
  });

  it("unlocks with the recovery key and a new passphrase", async () => {
    const { invoke } = renderGate("locked");
    fireEvent.click(await screen.findByRole("button", { name: "Forgot your passphrase?" }));
    const unlock = screen.getByRole("button", { name: "Unlock and save passphrase" });
    fireEvent.click(unlock);
    expect((await screen.findByRole("alert")).textContent).toBe("Enter your recovery key.");
    fireEvent.change(screen.getByLabelText("Recovery key"), { target: { value: "ABCD-EFGH" } });
    fireEvent.change(screen.getByLabelText("New passphrase"), { target: { value: "new words!" } });
    fireEvent.change(screen.getByLabelText("New passphrase again"), {
      target: { value: "new words?" },
    });
    fireEvent.click(unlock);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("The two passphrases don't match."),
    );
    fireEvent.change(screen.getByLabelText("New passphrase again"), {
      target: { value: "new words!" },
    });
    fireEvent.click(unlock);
    expect(await screen.findByText("The notes")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("security.resetPassphrase", {
      recoveryKey: "ABCD-EFGH",
      passphrase: "new words!",
    });
  });
});

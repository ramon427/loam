// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BridgeSecurityStatus } from "@loam/shared/bridge/loamBridge";

import { BridgeError } from "@loam/notes-ui/host/notesHost";
import { installFakeBridge } from "@loam/notes-ui/testing/fakeBridge";
import { SecuritySettings } from "../SecuritySettings";

const RECOVERY_KEY = "ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789";

const renderSecurity = (state: BridgeSecurityStatus["state"]) => {
  const { invoke } = installFakeBridge({
    "security.status": () => ({ state }),
    "security.newRecoveryKey": () => ({ recoveryKey: RECOVERY_KEY }),
    "security.enable": () => ({ state: "on" }),
    "security.disable": ({ passphrase }: { passphrase: string }) => {
      if (passphrase !== "right passphrase")
        throw new BridgeError("That passphrase isn't right.", "WRONG_PASSPHRASE");
      return { state: "off" };
    },
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SecuritySettings />
    </QueryClientProvider>,
  );
  return { invoke };
};

describe("SecuritySettings", () => {
  it("shows the recovery key and encrypts only once it is saved", async () => {
    const { invoke } = renderSecurity("off");
    fireEvent.click(await screen.findByRole("button", { name: /Encrypt my notes/ }));
    // A standing warning isn't announced; the problems below are, as alerts.
    const warning = screen.getByText(/can't be opened again, by you or by anyone else/);
    expect(warning.closest('[data-slot="notice"]')?.getAttribute("role")).toBeNull();
    fireEvent.change(screen.getByLabelText("Passphrase"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Use at least 8 characters.");
    fireEvent.change(screen.getByLabelText("Passphrase"), { target: { value: "long enough" } });
    fireEvent.change(screen.getByLabelText("Passphrase again"), {
      target: { value: "long enough" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect((await screen.findByTestId("recovery-key")).textContent).toBe(RECOVERY_KEY);
    const encrypt = screen.getByRole("button", { name: "Encrypt my notes" });
    expect((encrypt as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Save as a file/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("security.saveRecoveryKey", {}));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(encrypt);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("security.enable", {
        passphrase: "long enough",
        recoveryKey: RECOVERY_KEY,
      }),
    );
    expect((await screen.findByTestId("settings-encryption-state")).textContent).toBe("On");
  });

  it("turns encryption off only with the passphrase", async () => {
    const { invoke } = renderSecurity("on");
    fireEvent.click(await screen.findByRole("button", { name: /Turn off encryption/ }));
    fireEvent.change(screen.getByLabelText("Passphrase"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn off encryption" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That passphrase isn't right.");
    fireEvent.change(screen.getByLabelText("Passphrase"), {
      target: { value: "right passphrase" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Turn off encryption" }));
    await waitFor(() =>
      expect(screen.getByTestId("settings-encryption-state").textContent).toBe("Off"),
    );
    expect(invoke).toHaveBeenCalledWith("security.disable", { passphrase: "right passphrase" });
  });
});

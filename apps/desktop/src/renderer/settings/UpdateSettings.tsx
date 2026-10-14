import { RefreshCwIcon } from "lucide-react";

import type { BridgeUpdateStatus } from "@loam/shared/bridge/loamBridge";
import { formatDateTime } from "../lib/format";
import { useCheckForUpdates, useInstallUpdate } from "../shell/useAppUpdates";
import { Button } from "../ui/Button";

import { useAppInfo, useUpdateStatus } from "./queries";
import { SettingsNotice, SettingsRow, SettingsSection } from "./SettingsLayout";

const describeState = (update: BridgeUpdateStatus) => {
  switch (update.state) {
    case "unavailable":
      return "This copy of Loam doesn't update itself.";
    case "checking":
      return "Checking for updates…";
    case "downloading":
      return `Downloading ${update.version ?? "update"}… ${update.progress ?? 0}%`;
    case "ready":
      return `Version ${update.version ?? ""} is ready. Restart to install it.`;
    case "error":
      return "Not up to date";
    case "idle":
      return update.lastCheckedAt
        ? `Up to date. Checked ${formatDateTime(update.lastCheckedAt)}`
        : "Waiting to check";
  }
};

/** The running version and its updates, which download in the background. */
export function UpdateSettings() {
  const info = useAppInfo();
  const status = useUpdateStatus();
  const check = useCheckForUpdates();
  const install = useInstallUpdate();

  const update = status.data;
  const busy = update?.state === "checking" || update?.state === "downloading";

  return (
    <SettingsSection description="Loam checks for updates every hour and downloads them in the background. A downloaded update installs when you restart, or the next time you quit.">
      {status.isError ? (
        <SettingsNotice tone="danger">Could not read the update status.</SettingsNotice>
      ) : null}
      {update?.error ? <SettingsNotice tone="danger">{update.error}</SettingsNotice> : null}
      <SettingsRow title="Version" description={info.data?.version ?? "…"} />
      <SettingsRow
        title="Status"
        description={
          <span data-testid="settings-update-status">{update ? describeState(update) : "…"}</span>
        }
        control={
          update?.state === "ready" ? (
            <Button size="sm" disabled={install.isPending} onClick={() => install.mutate()}>
              <RefreshCwIcon className="size-4" aria-hidden="true" />
              Restart to update
            </Button>
          ) : update && update.state !== "unavailable" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy || check.isPending}
              onClick={() => check.mutate()}
            >
              <RefreshCwIcon className="size-4" aria-hidden="true" />
              Check for updates
            </Button>
          ) : null
        }
      />
    </SettingsSection>
  );
}

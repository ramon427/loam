import type { AppUpdater } from "electron-updater";

import type { BridgeUpdateStatus } from "@loam/shared/bridge/loamBridge";

import { normalizeReleaseNotes } from "./releaseNotes";

/** When to look for updates. Tests shorten these. */
export type UpdateTiming = { startupDelayMs: number; pollMs: number };

const DEFAULT_TIMING: UpdateTiming = { startupDelayMs: 15_000, pollMs: 60 * 60_000 };

type Updater = Pick<
  AppUpdater,
  | "on"
  | "checkForUpdates"
  | "quitAndInstall"
  | "autoDownload"
  | "autoInstallOnAppQuit"
  | "fullChangelog"
>;

export type UpdateService = {
  status: () => BridgeUpdateStatus;
  /** Checks now, unless a check or download is under way or an update is ready. */
  check: () => Promise<BridgeUpdateStatus>;
  /** Quits and installs the downloaded update, then starts the new version. */
  install: () => void;
  stop: () => void;
};

/**
 * Looks for updates on GitHub Releases shortly after launch and then hourly,
 * and downloads them in the background. A downloaded update installs when the
 * user restarts from the window, or on its own the next time the app quits.
 * Without an `updater` (development runs) the status stays "unavailable".
 */
export const createUpdateService = ({
  updater,
  onStatus,
  timing = DEFAULT_TIMING,
}: {
  updater: Updater | null;
  onStatus: (status: BridgeUpdateStatus) => void;
  timing?: UpdateTiming;
}): UpdateService => {
  let status: BridgeUpdateStatus = {
    state: updater ? "idle" : "unavailable",
    version: null,
    progress: null,
    lastCheckedAt: null,
    error: null,
    releaseNotes: [],
    omittedReleaseCount: 0,
  };
  if (!updater)
    return {
      status: () => status,
      check: async () => status,
      install: () => undefined,
      stop: () => undefined,
    };

  const update = (next: Partial<BridgeUpdateStatus>) => {
    status = { ...status, ...next };
    onStatus(status);
  };
  const fail = (error: unknown) => {
    console.error("Update failed", error);
    update({
      state: "error",
      progress: null,
      lastCheckedAt: Date.now(),
      error:
        status.state === "downloading"
          ? "The update could not be downloaded. Loam tries again later."
          : "Could not check for updates. Loam tries again later.",
    });
  };

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  // Notes for every release since this version, not only the newest.
  updater.fullChangelog = true;
  updater.on("checking-for-update", () => update({ state: "checking", error: null }));
  updater.on("update-not-available", () =>
    update({
      state: "idle",
      version: null,
      progress: null,
      lastCheckedAt: Date.now(),
      releaseNotes: [],
      omittedReleaseCount: 0,
    }),
  );
  updater.on("update-available", (info) =>
    update({
      state: "downloading",
      version: info.version,
      progress: 0,
      lastCheckedAt: Date.now(),
      ...normalizeReleaseNotes(info.releaseNotes, info.version),
    }),
  );
  updater.on("download-progress", (progress) => update({ progress: Math.round(progress.percent) }));
  updater.on("update-downloaded", (info) =>
    update({
      state: "ready",
      version: info.version,
      progress: null,
      ...normalizeReleaseNotes(info.releaseNotes, info.version),
    }),
  );
  updater.on("error", fail);

  const check = async () => {
    if (status.state === "checking" || status.state === "downloading" || status.state === "ready")
      return status;
    // Failures also arrive as an "error" event; this covers ones that don't.
    await updater.checkForUpdates().catch((error: unknown) => {
      if (status.state === "checking") fail(error);
    });
    return status;
  };

  const startup = setTimeout(() => void check(), timing.startupDelayMs);
  const poll = setInterval(() => void check(), timing.pollMs);
  startup.unref?.();
  poll.unref?.();

  return {
    status: () => status,
    check,
    install: () => {
      // Silent, since the user already chose to update; the new version starts after.
      if (status.state === "ready") updater.quitAndInstall(true, true);
    },
    stop: () => {
      clearTimeout(startup);
      clearInterval(poll);
    },
  };
};

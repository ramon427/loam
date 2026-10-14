import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { BridgeUpdateStatus } from "@loam/shared/bridge/loamBridge";

import { createUpdateService, type UpdateService } from "../updates";

/** Stands in for electron-updater: each check runs the given script of events. */
const fakeUpdater = (script: (updater: EventEmitter) => void | Promise<void>) => {
  const updater = Object.assign(new EventEmitter(), {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    fullChangelog: false,
    checkForUpdates: vi.fn(async () => {
      updater.emit("checking-for-update");
      await script(updater);
      return null;
    }),
    quitAndInstall: vi.fn(),
  });
  return updater;
};

const services: UpdateService[] = [];
const start = (updater: ReturnType<typeof fakeUpdater> | null) => {
  const statuses: BridgeUpdateStatus[] = [];
  const service = createUpdateService({
    updater: updater as never,
    onStatus: (status) => statuses.push(status),
    timing: { startupDelayMs: 60_000, pollMs: 60_000 },
  });
  services.push(service);
  return { service, statuses };
};

afterEach(() => {
  for (const service of services.splice(0)) service.stop();
  vi.restoreAllMocks();
});

describe("update service", () => {
  it("is unavailable without an updater", async () => {
    const { service } = start(null);
    expect(await service.check()).toMatchObject({ state: "unavailable" });
  });

  it("downloads an update in the background and installs it on request", async () => {
    const updater = fakeUpdater((emitter) => {
      emitter.emit("update-available", { version: "0.2.0" });
      emitter.emit("download-progress", { percent: 41.6 });
      emitter.emit("update-downloaded", { version: "0.2.0" });
    });
    const { service, statuses } = start(updater);
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);

    expect(await service.check()).toMatchObject({ state: "ready", version: "0.2.0" });
    expect(statuses.map((status) => status.state)).toEqual([
      "checking",
      "downloading",
      "downloading",
      "ready",
    ]);
    expect(statuses[2]?.progress).toBe(42);

    // A ready update isn't checked again.
    await service.check();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);

    service.install();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it("carries the changelog of every release since this version", async () => {
    const updater = fakeUpdater((emitter) => {
      const info = {
        version: "0.3.0",
        releaseNotes: [
          { version: "0.3.0", note: "<h2>What's Changed</h2><ul><li>Faster search</li></ul>" },
          { version: "0.2.1", note: "<ul><li>Fix &amp; polish</li></ul>" },
        ],
      };
      emitter.emit("update-available", info);
      emitter.emit("update-downloaded", info);
    });
    const { service } = start(updater);
    expect(updater.fullChangelog).toBe(true);

    expect(await service.check()).toMatchObject({
      state: "ready",
      releaseNotes: [
        { version: "0.3.0", items: ["Faster search"], totalItems: 1 },
        { version: "0.2.1", items: ["Fix & polish"], totalItems: 1 },
      ],
      omittedReleaseCount: 0,
    });
  });

  it("reports when it is up to date", async () => {
    const { service } = start(fakeUpdater((emitter) => void emitter.emit("update-not-available")));
    const status = await service.check();
    expect(status).toMatchObject({ state: "idle", version: null, error: null });
    expect(status.lastCheckedAt).toBeTypeOf("number");
  });

  it("explains a failed check and recovers on the next one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let reachable = false;
    const { service } = start(
      fakeUpdater((emitter) => {
        if (!reachable) throw new Error("HttpError: 404");
        emitter.emit("update-not-available");
      }),
    );

    expect(await service.check()).toMatchObject({
      state: "error",
      error: "Could not check for updates. Loam tries again later.",
    });
    reachable = true;
    expect(await service.check()).toMatchObject({ state: "idle", error: null });
  });

  it("doesn't install before an update is ready", () => {
    const updater = fakeUpdater(() => undefined);
    start(updater).service.install();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
});

import type { BridgePluginInfo } from "@loam/shared/plugins/pluginApi";
import { settingValue, type PluginSettingValue } from "@loam/shared/plugins/pluginManifest";

import { callBridge, onBridgeEvent } from "../bridge";
import { onNoteSaved } from "../workspace/noteSaves";

import { matches, runChain, type HookRegistration } from "./hookChain";
import { asRecord, createPluginCalls, type PluginCaller } from "./pluginCalls";
import {
  createPluginContributions,
  type PluginCommand,
  type PluginPane,
  type PluginSlashItem,
} from "./pluginContributions";
import { createPluginInstance, type PluginInstance, type WorkerPort } from "./pluginInstance";

/*
 * The plugins running in this window: one worker each, their hooks, and what they added to the
 * window (commands, slash menu items, open panes). React reads it through `subscribe` and
 * `snapshot`; the app's own code raises events through `dispatch` and draws through `render`.
 */

export type PluginLogEntry = { at: number; level: "info" | "warn" | "error"; text: string };

type Running = PluginCaller & {
  /** What it was started from; a reload restarts it only when this differs. */
  fingerprint: string;
  instance: PluginInstance;
  status: "loading" | "running" | "failed";
};

export type HostSnapshot = {
  version: number;
  /** The plugins with ui.render hooks, in the order their parts are drawn. */
  renderers: readonly string[];
  /** Per plugin, bumped when what it draws may have changed. */
  drawVersions: Readonly<Record<string, number>>;
  commands: readonly PluginCommand[];
  slashItems: readonly PluginSlashItem[];
  panes: readonly PluginPane[];
  status: Readonly<Record<string, Running["status"]>>;
  logs: Readonly<Record<string, readonly PluginLogEntry[]>>;
};

const MAX_LOG = 50;

/** The default way a plugin's worker starts; tests give the host another. */
const startWorker = (): WorkerPort => {
  const worker = new Worker(new URL("./pluginWorker.ts", import.meta.url), {
    type: "module",
    name: "pluginWorker",
  });
  return {
    post: (message) => worker.postMessage(message),
    listen: (handler) => {
      worker.onmessage = (event) => handler(event.data);
    },
    terminate: () => worker.terminate(),
  };
};

export const createPluginHost = ({
  spawn = startWorker,
}: { spawn?: (pluginId: string) => WorkerPort } = {}) => {
  const running = new Map<string, Running>();
  let registrations: HookRegistration[] = [];
  const logs = new Map<string, PluginLogEntry[]>();
  /** Handler ids each drawing used, released when it is drawn again or goes away. */
  const drawnHandlers = new Map<string, { pluginId: string; ids: string[] }>();
  const listeners = new Set<() => void>();
  let version = 0;
  let snapshot: HostSnapshot | null = null;
  let generation = 0;

  const notify = () => {
    snapshot = null;
    for (const listener of listeners) listener();
  };
  /** What plugins added to the window changed: commands, panes, hooks, status. */
  const changed = () => {
    version += 1;
    notify();
  };
  /** Something one plugin draws from changed; only its parts of each slot draw again. */
  const drawVersions = new Map<string, number>();
  const redraw = (pluginId: string) => {
    drawVersions.set(pluginId, (drawVersions.get(pluginId) ?? 0) + 1);
    changed();
  };
  const contributions = createPluginContributions(changed);

  const log = (pluginId: string, level: PluginLogEntry["level"], text: string) => {
    const entries = [...(logs.get(pluginId) ?? []), { at: Date.now(), level, text }];
    logs.set(pluginId, entries.slice(-MAX_LOG));
    if (level === "error") console.warn(`Plugin ${pluginId}: ${text}`);
    // Not a new version: a refused drawing logs, and drawing again would only log again.
    notify();
  };

  const handleCall = createPluginCalls({
    getPlugin: (pluginId) => running.get(pluginId),
    contributions,
    redraw,
  });

  const settingsOf = (info: BridgePluginInfo & { ok: true }) =>
    Object.fromEntries(
      info.manifest.settings.map((setting) => [setting.key, settingValue(setting, info.settings)]),
    ) as Record<string, PluginSettingValue>;

  const forget = (pluginId: string) => {
    drawVersions.delete(pluginId);
    registrations = registrations.filter((registration) => registration.pluginId !== pluginId);
    contributions.forget(pluginId);
    for (const [requestId, drawn] of drawnHandlers)
      if (drawn.pluginId === pluginId) drawnHandlers.delete(requestId);
  };

  const stopPlugin = (pluginId: string) => {
    running.get(pluginId)?.instance.stop();
    running.delete(pluginId);
    forget(pluginId);
  };

  /** Starts a plugin from its module's text; `fingerprint` says what it was started from. */
  const startPlugin = async (
    info: BridgePluginInfo & { ok: true },
    code: string,
    fingerprint: string,
  ) => {
    const pluginId = info.manifest.id;
    const instance = createPluginInstance({
      pluginId,
      port: spawn(pluginId),
      onCall: (path, args) => handleCall(pluginId, path, args),
      onHook: (registration) => {
        registrations = [...registrations, registration];
        changed();
      },
      onLog: (level, text) => log(pluginId, level, text),
    });
    const plugin: Running = {
      manifest: info.manifest,
      granted: info.granted,
      fingerprint,
      instance,
      state: new Map(),
      status: "loading",
    };
    running.set(pluginId, plugin);
    changed();
    instance.load(code, settingsOf(info));
    try {
      await instance.ready;
      plugin.status = "running";
      changed();
      void host.dispatch("app.ready", {}, () => null, pluginId);
    } catch (error) {
      plugin.status = "failed";
      log(
        pluginId,
        "error",
        `It could not start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  /**
   * Reads the plugins folder again and brings the running plugins in line with it. A plugin
   * whose module, manifest, grants and settings are unchanged keeps running, with its state;
   * any other is started afresh. `restart` starts every one afresh.
   */
  const reload = async ({ restart = false }: { restart?: boolean } = {}) => {
    const current = (generation += 1);
    let list;
    try {
      list = await callBridge("plugins.list", {});
    } catch {
      return;
    }
    if (current !== generation) return;
    const wanted = list.restrictedMode
      ? []
      : list.plugins.filter(
          (info): info is BridgePluginInfo & { ok: true } => info.ok && info.enabled,
        );
    for (const pluginId of [...running.keys()])
      if (!wanted.some((info) => info.manifest.id === pluginId)) stopPlugin(pluginId);
    changed();
    await Promise.all(
      wanted.map(async (info) => {
        const pluginId = info.manifest.id;
        try {
          const { code } = await callBridge("plugins.source", { id: pluginId });
          if (current !== generation) return;
          const fingerprint = JSON.stringify([code, info.manifest, info.granted, info.settings]);
          if (!restart && running.get(pluginId)?.fingerprint === fingerprint) return;
          stopPlugin(pluginId);
          await startPlugin(info, code, fingerprint);
        } catch (error) {
          log(
            pluginId,
            "error",
            `It could not start: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
    );
  };

  const ordered = () =>
    [...registrations].sort((a, b) => {
      const order = [...running.keys()].sort();
      return order.indexOf(a.pluginId) - order.indexOf(b.pluginId);
    });

  const host = {
    /** Starts every plugin that is switched on, and restarts them when their files change. */
    start() {
      void reload();
      const observe = (event: string, e: unknown) => {
        if (host.hooks(event)) void host.dispatch(event, e, () => null);
      };
      const stops = [
        onBridgeEvent("plugins.changed", () => void reload()),
        onNoteSaved((noteId) => observe("note.saved", { noteId })),
        onBridgeEvent("notes.changed", (change) =>
          observe("notes.changed", {
            changedNoteIds: change.changedNoteIds,
            deletedNoteIds: change.deletedNoteIds,
          }),
        ),
      ];
      return () => {
        for (const stop of stops) stop();
        generation += 1;
        for (const pluginId of [...running.keys()]) stopPlugin(pluginId);
        changed();
      };
    },

    reload,

    /** Whether any plugin hooks `event`, so callers can skip the round trip when none does. */
    hooks(event: string) {
      return registrations.some((registration) => registration.event === event);
    },

    /**
     * Runs `event` through the hooks that match it and then `base`, the app's own behaviour.
     * `only` limits it to one plugin, as `app.ready` is raised for each as it starts.
     */
    dispatch(event: string, e: unknown, base: (e: unknown) => unknown, only?: string) {
      const chain = ordered().filter(
        (registration) =>
          registration.event === event &&
          (!only || registration.pluginId === only) &&
          running.get(registration.pluginId)?.status !== "failed" &&
          matches(registration.matcher, e),
      );
      return runChain(
        chain,
        e,
        (registration, current, next) =>
          running.get(registration.pluginId)?.instance.invoke(registration.hookId, current, next) ??
          Promise.reject(new Error("The plugin stopped.")),
        base,
        (registration, error) =>
          log(
            registration.pluginId,
            "error",
            `${event} hook: ${error instanceof Error ? error.message : String(error)}`,
          ),
      );
    },

    /**
     * What one plugin draws for one place in the window, or null. Each plugin draws its own
     * part, so a press only ever reaches the plugin that drew the button.
     */
    renderPart(slot: string, requestId: string, props: Record<string, unknown>, pluginId: string) {
      return host.dispatch("ui.render", { slot, requestId, props }, () => null, pluginId);
    },

    /** Remembers which handlers a drawing uses, releasing those of what it drew before. */
    drew(requestId: string, pluginId: string | null, handlerIds: string[]) {
      const previous = drawnHandlers.get(requestId);
      if (previous) {
        const kept = new Set(handlerIds);
        running
          .get(previous.pluginId)
          ?.instance.release(previous.ids.filter((id) => !kept.has(id)));
      }
      if (pluginId) drawnHandlers.set(requestId, { pluginId, ids: handlerIds });
      else drawnHandlers.delete(requestId);
    },

    /** Sends a press, a typed value or a pick back to the plugin function that drew it. */
    press(pluginId: string, handlerId: string, payload: unknown) {
      running.get(pluginId)?.instance.press(handlerId, payload);
    },

    runCommand(commandId: string) {
      const command = contributions.commands.find((candidate) => candidate.id === commandId);
      if (!command) return Promise.resolve(null);
      return host.dispatch(
        "command.run",
        { command: command.id.slice(`plugin:${command.pluginId}.`.length) },
        () => null,
        command.pluginId,
      );
    },

    /** The Markdown a plugin's slash menu item inserts, if it gives any. */
    async runSlashItem(item: PluginSlashItem, noteId: string | null) {
      const result = asRecord(
        await host.dispatch("slash.run", { item: item.id, noteId }, () => null, item.pluginId),
      );
      return typeof result.markdown === "string" ? result.markdown : null;
    },

    closePane(pluginId: string, id: string) {
      contributions.closePane(pluginId, id);
    },

    log,

    pluginName(pluginId: string) {
      return running.get(pluginId)?.manifest.name ?? pluginId;
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    snapshot(): HostSnapshot {
      snapshot ??= {
        version,
        renderers: [
          ...new Set(
            ordered()
              .filter((registration) => registration.event === "ui.render")
              .map((registration) => registration.pluginId),
          ),
        ],
        drawVersions: Object.fromEntries(drawVersions),
        commands: contributions.commands,
        slashItems: contributions.slashItems,
        panes: contributions.panes,
        status: Object.fromEntries([...running].map(([id, plugin]) => [id, plugin.status])),
        logs: Object.fromEntries(logs),
      };
      return snapshot;
    },
  };
  return host;
};

export type PluginHost = ReturnType<typeof createPluginHost>;

/** The window's one host. */
export const pluginHost = createPluginHost();

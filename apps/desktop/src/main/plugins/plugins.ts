import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { shell } from "electron";
import { z } from "zod";

import {
  PLUGIN_OP_PERMISSIONS,
  type BridgePluginFetch,
  type BridgePluginInfo,
  type BridgePlugins,
  type PluginOp,
} from "@loam/shared/plugins/pluginApi";
import { networkAllows, type PluginSettingValue } from "@loam/shared/plugins/pluginManifest";
import { StoreError } from "@loam/storage/storeError";

import type { OpenLibrary } from "../library";
import { pluginFolderNames, readManifest } from "./manifests";
import { fetchForPlugin, type PluginFetchRequest } from "./pluginFetch";
import { runPluginOp } from "./pluginOps";
import { createPluginStore } from "./pluginStore";

const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const CHANGE_DELAY_MS = 200;

type PluginState = {
  enabled: boolean;
  granted: string[];
  settings: Record<string, PluginSettingValue>;
};

type PluginsFile = { restrictedMode: boolean; plugins: Record<string, PluginState> };

const settingValueSchema = z.union([z.string().max(10_000), z.number().finite(), z.boolean()]);

const pluginsFileSchema = z.object({
  restrictedMode: z.boolean().catch(true),
  plugins: z
    .record(
      z.string(),
      z.object({
        enabled: z.boolean().catch(false),
        granted: z.array(z.string()).catch([]),
        settings: z.record(z.string(), settingValueSchema).catch({}),
      }),
    )
    .catch({}),
});

const notAllowed = (message: string) => new StoreError(message, "PLUGIN_NOT_ALLOWED", 403);
const notFound = () => new StoreError("No plugin has that id.", "NOT_FOUND", 404);

/**
 * The plugins folder in the data folder and what the user allowed each plugin: which are on,
 * which permissions they were granted, and their settings, in plugins.json. Every request a
 * plugin makes comes through here and is checked against that, whatever the window asked.
 */
export const createPlugins = ({
  dataDirectory,
  library,
  onChange,
}: {
  dataDirectory: string;
  /** The open library; throws while notes are locked. */
  library: () => OpenLibrary;
  /** The plugins folder or plugins.json changed. */
  onChange: () => void;
}) => {
  const folder = join(dataDirectory, "plugins");
  const stateFile = join(dataDirectory, "plugins.json");
  const pluginStore = createPluginStore(join(dataDirectory, "plugin-data"));

  let state: PluginsFile | null = null;
  const readState = async (): Promise<PluginsFile> => {
    if (state) return state;
    try {
      state = pluginsFileSchema.parse(JSON.parse(await readFile(stateFile, "utf8")));
    } catch {
      state = { restrictedMode: true, plugins: {} };
    }
    return state;
  };
  const writeState = async (next: PluginsFile) => {
    state = next;
    const temporary = `${stateFile}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(next, null, 2));
    await rename(temporary, stateFile);
  };
  const pluginState = (file: PluginsFile, id: string): PluginState =>
    file.plugins[id] ?? { enabled: false, granted: [], settings: {} };

  const list = async (): Promise<BridgePlugins> => {
    const file = await readState();
    const names = await pluginFolderNames(folder);
    const plugins = await Promise.all(
      names.map(async (name): Promise<BridgePluginInfo> => {
        const own = pluginState(file, name);
        const manifest = await readManifest(folder, name);
        return {
          folder: name,
          ...own,
          // A permission the manifest no longer asks for is no longer granted.
          granted: manifest.ok
            ? own.granted.filter((permission) =>
                manifest.manifest.permissions.includes(permission as never),
              )
            : own.granted,
          ...manifest,
        };
      }),
    );
    return { restrictedMode: file.restrictedMode, plugins };
  };

  /** A plugin that may run now: on, and not held back by restricted mode. */
  const running = async (id: string) => {
    const file = await readState();
    const manifest = await readManifest(folder, id);
    if (!manifest.ok) throw notFound();
    const own = pluginState(file, id);
    if (file.restrictedMode || !own.enabled) throw notAllowed("That plugin is not switched on.");
    const granted = own.granted.filter((permission) =>
      manifest.manifest.permissions.includes(permission as never),
    );
    return { manifest: manifest.manifest, granted };
  };

  const requirePermission = (granted: readonly string[], permission: string) => {
    if (!granted.includes(permission))
      throw notAllowed(`The plugin was not granted the ${permission} permission.`);
  };

  let watcher: FSWatcher | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, CHANGE_DELAY_MS);
  };

  return {
    list,

    async setRestricted(restrictedMode: boolean) {
      const file = await readState();
      await writeState({ ...file, restrictedMode });
      changed();
    },

    /** Switches a plugin on with the permissions the user granted, which must be ones it asks for. */
    async setEnabled(id: string, enabled: boolean, granted?: readonly string[]) {
      const manifest = await readManifest(folder, id);
      if (!manifest.ok) throw notFound();
      const file = await readState();
      const own = pluginState(file, id);
      const next = (granted ?? own.granted).filter((permission) =>
        manifest.manifest.permissions.includes(permission as never),
      );
      await writeState({
        ...file,
        plugins: { ...file.plugins, [id]: { ...own, enabled, granted: next } },
      });
      changed();
    },

    async setSetting(id: string, key: string, value: PluginSettingValue) {
      const manifest = await readManifest(folder, id);
      if (!manifest.ok) throw notFound();
      const setting = manifest.manifest.settings.find((candidate) => candidate.key === key);
      const expected = setting?.type === "select" ? "string" : setting?.type;
      if (!setting || typeof value !== expected)
        throw new StoreError("The plugin has no such setting.", "VALIDATION_ERROR", 400);
      const file = await readState();
      const own = pluginState(file, id);
      await writeState({
        ...file,
        plugins: { ...file.plugins, [id]: { ...own, settings: { ...own.settings, [key]: value } } },
      });
      changed();
    },

    /** The module a running plugin loads. */
    async source(id: string) {
      const { manifest } = await running(id);
      const path = join(folder, id, manifest.main);
      if ((await stat(path)).size > MAX_SOURCE_BYTES)
        throw new StoreError("The plugin's module is over 4 MB.", "PLUGIN_TOO_LARGE", 413);
      return { code: await readFile(path, "utf8") };
    },

    async call(id: string, op: PluginOp, params: unknown) {
      const { granted } = await running(id);
      if (!Object.hasOwn(PLUGIN_OP_PERMISSIONS, op))
        throw new StoreError("Unknown plugin operation.", "VALIDATION_ERROR", 400);
      requirePermission(granted, PLUGIN_OP_PERMISSIONS[op]);
      return runPluginOp(op, params, () => library().store);
    },

    /** Fetches an https address on a host the plugin was granted; redirects are not followed. */
    async fetch(id: string, request: PluginFetchRequest): Promise<BridgePluginFetch> {
      const { granted } = await running(id);
      if (!networkAllows(granted, request.url))
        throw notAllowed("The plugin was not granted that address.");
      return fetchForPlugin(request);
    },

    async storeGet(id: string, key: string) {
      await running(id);
      return pluginStore.get(id, key);
    },

    async storeSet(id: string, key: string, value: unknown) {
      await running(id);
      await pluginStore.set(id, key, value);
      return null;
    },

    /** Opens the plugins folder in the file manager, making it first if it isn't there yet. */
    async reveal() {
      await mkdir(folder, { recursive: true });
      await shell.openPath(folder);
    },

    /** Watches the plugins folder, and everything in it, so edits reload as they are saved. */
    async start() {
      await mkdir(folder, { recursive: true }).catch(() => undefined);
      try {
        watcher = watch(folder, { recursive: true }, changed);
      } catch {
        // Without a watch, the Plugins settings' Reload button still reads the folder.
      }
    },

    close() {
      clearTimeout(timer);
      watcher?.close();
      watcher = null;
    },
  };
};

export type Plugins = ReturnType<typeof createPlugins>;

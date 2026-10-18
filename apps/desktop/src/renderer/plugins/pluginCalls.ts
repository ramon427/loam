import type { PluginOp } from "@loam/shared/plugins/pluginApi";
import type { PluginManifest } from "@loam/shared/plugins/pluginManifest";

import { callBridge } from "../bridge";
import { emitAppEvent } from "../lib/appEventBus";
import { toastError, toastInfo, toastSuccess, toastWarning } from "../ui/toast";

import { isHandlerRef } from "./protocol";

import type { PluginContributions } from "./pluginContributions";

/*
 * The `$` API a plugin calls from its worker. Each call's arguments come from plugin code, so
 * they are checked here before anything reaches the app or the main process.
 */

const MAX_TOAST_LENGTH = 500;

const asString = (value: unknown, field: string, max = 200) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${field} must be a string of up to ${max} characters.`);
  return value;
};

const isPlainHeaders = (value: unknown): value is Record<string, string> =>
  Boolean(value) &&
  typeof value === "object" &&
  Object.values(value as object).every((header) => typeof header === "string");

export const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** What a call needs of the plugin making it. */
export type PluginCaller = {
  manifest: PluginManifest;
  granted: readonly string[];
  /** What the plugin keeps while it runs; changing it redraws what the plugin draws. */
  state: Map<string, unknown>;
};

const requirePermission = (plugin: PluginCaller, permission: string) => {
  if (!plugin.granted.includes(permission))
    throw new Error(`The plugin was not granted the ${permission} permission.`);
};

const parseBlocks = async (markdown: unknown) => {
  if (markdown === undefined) return [];
  const { parseMarkdown } = await import("../editor/blockParsers");
  return parseMarkdown(asString(markdown, "markdown", 1_000_000));
};

const op = (pluginId: string, name: PluginOp, params: unknown) =>
  callBridge("plugins.call", { id: pluginId, op: name, params });

/**
 * Answers the `$` calls of running plugins. `redraw` says that what a plugin draws from
 * changed.
 */
export const createPluginCalls = ({
  getPlugin,
  contributions,
  redraw,
  press,
}: {
  getPlugin: (pluginId: string) => PluginCaller | undefined;
  contributions: PluginContributions;
  redraw: (pluginId: string) => void;
  /** Calls a function the plugin passed, such as a toast's action. */
  press: (pluginId: string, handlerId: string) => void;
}) =>
  /** Answers one `$` call of a running plugin. */
  async function handleCall(pluginId: string, path: string, args: unknown[]): Promise<unknown> {
    const plugin = getPlugin(pluginId);
    if (!plugin) throw new Error("The plugin is not running.");
    const [first, second] = args;
    switch (path) {
      case "notes.get":
        return op(pluginId, "notes.get", { noteId: asString(first, "noteId", 512) });
      case "notes.list":
        return op(pluginId, "notes.list", {});
      case "notes.search":
        return op(pluginId, "notes.search", {
          query: asString(first, "query"),
          ...(typeof asRecord(second).limit === "number" && { limit: asRecord(second).limit }),
        });
      case "notes.backlinks":
        return op(pluginId, "notes.backlinks", { noteId: asString(first, "noteId", 512) });
      case "notes.create": {
        const input = asRecord(first);
        requirePermission(plugin, "notes:write");
        return op(pluginId, "notes.create", {
          title: typeof input.title === "string" ? input.title : "",
          blocks: await parseBlocks(input.markdown),
          ...(typeof input.folderId === "string" && { folderId: input.folderId }),
        });
      }
      case "notes.setTitle":
        return op(pluginId, "notes.setTitle", {
          noteId: asString(first, "noteId", 512),
          title: typeof second === "string" ? second : "",
        });
      case "notes.append":
        requirePermission(plugin, "notes:write");
        return op(pluginId, "notes.append", {
          noteId: asString(first, "noteId", 512),
          blocks: await parseBlocks(second),
        });
      case "notes.trash":
        return op(pluginId, "notes.trash", { noteId: asString(first, "noteId", 512) });

      case "ui.toast": {
        requirePermission(plugin, "ui");
        const text = asString(first, "text", MAX_TOAST_LENGTH);
        const { tone, action, duration } = asRecord(second);
        const { label, onPress } = asRecord(action);
        const show =
          tone === "success"
            ? toastSuccess
            : tone === "error"
              ? toastError
              : tone === "warning"
                ? toastWarning
                : toastInfo;
        show(text, {
          description: plugin.manifest.name,
          ...(typeof label === "string" &&
            label.trim() &&
            isHandlerRef(onPress) && {
              action: {
                label: label.slice(0, 40),
                onClick: () => press(pluginId, onPress.__handler),
              },
            }),
          ...(typeof duration === "number" &&
            duration >= 1000 &&
            duration <= 30_000 && { duration }),
        });
        return null;
      }
      case "ui.open": {
        requirePermission(plugin, "ui");
        const input = asRecord(first);
        contributions.openPane({
          pluginId,
          id: asString(input.id, "id", 64),
          title: asString(input.title, "title", 80),
          place: input.place === "main" ? "main" : "side",
        });
        return null;
      }
      case "ui.prompt": {
        requirePermission(plugin, "ui");
        const input = asRecord(first);
        return contributions.ask({
          pluginId,
          title: asString(input.title, "title", 120),
          ...(typeof input.placeholder === "string" && {
            placeholder: input.placeholder.slice(0, 200),
          }),
          ...(typeof input.value === "string" && { value: input.value.slice(0, 10_000) }),
        });
      }
      case "ui.choose": {
        requirePermission(plugin, "ui");
        const input = asRecord(first);
        const choices = Array.isArray(input.choices)
          ? input.choices.slice(0, 6).map((choice) => {
              const { value, label, tone } = asRecord(choice);
              return {
                value: asString(value, "value", 100),
                label: asString(label, "label", 80),
                ...(tone === "danger" && { tone: "danger" as const }),
              };
            })
          : [];
        if (!choices.length) throw new Error("choices must list at least one choice.");
        return contributions.choose({
          pluginId,
          title: asString(input.title, "title", 120),
          ...(typeof input.description === "string" && {
            description: input.description.slice(0, 500),
          }),
          choices,
        });
      }
      case "ui.close":
        contributions.closePane(pluginId, asString(first, "id", 64));
        return null;
      case "ui.invalidate":
        redraw(pluginId);
        return null;
      case "ui.openNote":
        emitAppEvent("notes:open", { noteId: asString(first, "noteId", 512) });
        return null;

      case "commands.register": {
        const input = asRecord(first);
        contributions.registerCommand({
          pluginId,
          id: `plugin:${pluginId}.${asString(input.id, "id", 64)}`,
          title: asString(input.title, "title", 120),
          ...(typeof input.key === "string" && input.key.length <= 40 && { key: input.key }),
        });
        return null;
      }
      case "editor.registerSlashItem": {
        const input = asRecord(first);
        contributions.registerSlashItem({
          pluginId,
          id: asString(input.id, "id", 64),
          title: asString(input.title, "title", 80),
          ...(typeof input.subtext === "string" && { subtext: input.subtext.slice(0, 120) }),
          aliases: Array.isArray(input.aliases)
            ? input.aliases
                .filter((alias): alias is string => typeof alias === "string")
                .slice(0, 10)
            : [],
        });
        return null;
      }

      case "state.get":
        return plugin.state.get(asString(first, "key")) ?? null;
      case "state.set": {
        const key = asString(first, "key");
        // An unchanged value redraws nothing, so a drawing that sets what it read doesn't loop.
        if (JSON.stringify(plugin.state.get(key) ?? null) === JSON.stringify(second ?? null))
          return null;
        if (second === null || second === undefined) plugin.state.delete(key);
        else plugin.state.set(key, second);
        redraw(pluginId);
        return null;
      }
      case "store.get":
        return callBridge("plugins.storeGet", { id: pluginId, key: asString(first, "key") });
      case "store.set":
        return callBridge("plugins.storeSet", {
          id: pluginId,
          key: asString(first, "key"),
          value: second ?? null,
        });

      case "net.fetch": {
        const init = asRecord(second);
        return callBridge("plugins.fetch", {
          id: pluginId,
          url: asString(first, "url", 8192),
          ...(typeof init.method === "string" && { method: init.method.toUpperCase() as "GET" }),
          ...(isPlainHeaders(init.headers) && { headers: init.headers }),
          ...(typeof init.body === "string" && { body: init.body }),
        });
      }

      case "google.status":
        requirePermission(plugin, "google:calendar");
        return callBridge("plugins.googleStatus", { id: pluginId });
      case "google.signIn":
        requirePermission(plugin, "google:calendar");
        return callBridge("plugins.googleSignIn", { id: pluginId });
      case "google.calendar": {
        requirePermission(plugin, "google:calendar");
        const input = asRecord(first);
        const method = typeof input.method === "string" ? input.method.toUpperCase() : "GET";
        if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method))
          throw new Error("method must be GET, POST, PUT, PATCH or DELETE.");
        return callBridge("plugins.googleCalendar", {
          id: pluginId,
          request: {
            method: method as "GET",
            path: asString(input.path, "path", 2048),
            ...(input.query !== undefined && {
              query: asRecord(input.query) as Record<string, string>,
            }),
            ...(typeof input.body === "string" && { body: input.body }),
            ...(isPlainHeaders(input.headers) && { headers: input.headers }),
          },
        });
      }

      case "app.activeNote":
        return new Promise((resolve) =>
          emitAppEvent("notes:read-open", {
            respond: (open) => resolve(open.noteId ? open : null),
          }),
        );
    }
    throw new Error(`$.${path} is not part of the plugin API.`);
  };

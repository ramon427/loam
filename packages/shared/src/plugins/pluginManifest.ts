import { z } from "zod";

/*
 * A plugin's manifest.json. A plugin is a folder in the data folder's plugins folder holding
 * this manifest and one bundled ES module (`main`) that exports `register`. The module runs in a
 * worker of its own and reaches notes, the network and the window only through what its
 * granted permissions allow.
 */

/** The plugin API this build runs; a manifest asking for another is refused. */
const PLUGIN_API_VERSION = 1;

const HOST = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const PLUGIN_PERMISSIONS = {
  "notes:read": "Read your notes",
  "notes:write": "Create, change and trash notes",
  ui: "Show panels, buttons and notifications in the window",
  "google:calendar":
    "See and change the events in your Google calendars, once you sign in to Google",
} as const;

export type PluginPermission = keyof typeof PLUGIN_PERMISSIONS | `network:${string}`;

const isNetworkPermission = (permission: string): permission is `network:${string}` =>
  permission.startsWith("network:") && HOST.test(permission.slice("network:".length));

const isPluginPermission = (permission: string): permission is PluginPermission =>
  Object.hasOwn(PLUGIN_PERMISSIONS, permission) || isNetworkPermission(permission);

/** What a user is asked to allow, in words. */
export const describePermission = (permission: PluginPermission) =>
  isNetworkPermission(permission)
    ? `Connect to ${permission.slice("network:".length)}`
    : PLUGIN_PERMISSIONS[permission as keyof typeof PLUGIN_PERMISSIONS];

/** Whether `url` is one a plugin granted `network:<host>` may fetch. */
export const networkAllows = (granted: readonly string[], url: string) => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return granted.some((permission) => {
    if (!isNetworkPermission(permission)) return false;
    const host = permission.slice("network:".length);
    return host.startsWith("*.")
      ? parsed.hostname.endsWith(host.slice(1))
      : parsed.hostname === host;
  });
};

const settingSchema = z.discriminatedUnion("type", [
  z.object({
    key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
    type: z.literal("string"),
    label: z.string().min(1).max(80),
    description: z.string().max(300).optional(),
    /** Kept so a plugin can still read an old value it has moved elsewhere; not shown. */
    hidden: z.boolean().optional(),
    default: z.string().max(10_000).optional(),
  }),
  z.object({
    key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
    type: z.literal("number"),
    label: z.string().min(1).max(80),
    description: z.string().max(300).optional(),
    hidden: z.boolean().optional(),
    default: z.number().finite().optional(),
  }),
  z.object({
    key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
    type: z.literal("boolean"),
    label: z.string().min(1).max(80),
    description: z.string().max(300).optional(),
    hidden: z.boolean().optional(),
    default: z.boolean().optional(),
  }),
  z.object({
    key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
    type: z.literal("select"),
    label: z.string().min(1).max(80),
    description: z.string().max(300).optional(),
    hidden: z.boolean().optional(),
    options: z
      .array(z.object({ value: z.string().max(200), label: z.string().max(80) }))
      .min(1)
      .max(50),
    default: z.string().max(200).optional(),
  }),
]);

export type PluginSetting = z.infer<typeof settingSchema>;
export type PluginSettingValue = string | number | boolean;

export const pluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/, "Use lowercase letters, digits and hyphens"),
  name: z.string().min(1).max(80),
  version: z.string().min(1).max(32),
  description: z.string().max(300).optional(),
  author: z.string().max(80).optional(),
  apiVersion: z.literal(PLUGIN_API_VERSION),
  main: z
    .string()
    .regex(/^[\w.-]+\.m?js$/, "main is a .js file next to manifest.json")
    .default("main.js"),
  permissions: z
    .array(z.string().refine(isPluginPermission, "Unknown permission"))
    .max(32)
    .default([])
    .transform((permissions) => [...new Set(permissions)] as PluginPermission[]),
  settings: z
    .array(settingSchema)
    .max(50)
    .default([])
    .refine(
      (settings) => new Set(settings.map((setting) => setting.key)).size === settings.length,
      "Setting keys must differ",
    ),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

/** A setting's value as saved, else its default, else its type's empty value. */
export const settingValue = (
  setting: PluginSetting,
  saved: Record<string, PluginSettingValue>,
): PluginSettingValue => {
  const value = saved[setting.key];
  const fallback =
    setting.default ??
    (setting.type === "number"
      ? 0
      : setting.type === "boolean"
        ? false
        : setting.type === "select"
          ? setting.options[0]!.value
          : "");
  if (value === undefined || typeof value !== typeof fallback) return fallback;
  if (setting.type === "select" && !setting.options.some((option) => option.value === value))
    return fallback;
  return value;
};

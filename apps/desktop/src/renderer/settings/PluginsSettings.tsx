import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpenIcon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react";

import type { BridgePluginInfo } from "@loam/shared/plugins/pluginApi";
import {
  describePermission,
  settingValue,
  type PluginManifest,
  type PluginPermission,
  type PluginSetting,
  type PluginSettingValue,
} from "@loam/shared/plugins/pluginManifest";

import { callBridge, onBridgeEvent } from "../bridge";
import { pluginHost } from "../plugins/host";
import { usePluginHost } from "../plugins/PluginSlot";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Input } from "../ui/Input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/Select";
import { toastError } from "../ui/toast";

import { FormDialog } from "./FormDialog";
import { GoogleAccountSettings } from "./GoogleAccountSettings";
import {
  SettingsDetails,
  SettingsNote,
  SettingsNotice,
  SettingsRow,
  SettingsSection,
} from "./SettingsLayout";

const PLUGINS_KEY = ["plugins"];

const usePlugins = () => {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      onBridgeEvent(
        "plugins.changed",
        () => void queryClient.invalidateQueries({ queryKey: PLUGINS_KEY }),
      ),
    [queryClient],
  );
  return useQuery({ queryKey: PLUGINS_KEY, queryFn: () => callBridge("plugins.list", {}) });
};

const useChange = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: () => Promise<unknown>) => change(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: PLUGINS_KEY }),
    onError: () => toastError("The change could not be saved."),
  });
};

/** Asks before a plugin runs, naming everything it may do. */
function PermissionDialog({
  manifest,
  busy,
  onAllow,
  onClose,
}: {
  manifest: PluginManifest;
  busy: boolean;
  onAllow: () => void;
  onClose: () => void;
}) {
  return (
    <FormDialog
      title={`Turn on ${manifest.name}?`}
      description={
        manifest.permissions.length
          ? "This plugin will be able to:"
          : "This plugin asks for no permissions. It can only react to what happens in the window."
      }
      busy={busy}
      onClose={onClose}
      onSubmit={onAllow}
      footer={
        <>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy}>
            Turn on
          </Button>
        </>
      }
    >
      {manifest.permissions.length ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-xs text-(--app-text)">
          {manifest.permissions.map((permission) => (
            <li key={permission} className="flex items-center gap-2">
              <ShieldCheckIcon className="size-3.5 shrink-0 text-(--app-muted)" aria-hidden />
              {describePermission(permission as PluginPermission)}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="m-0 text-xs text-(--app-muted)">
        Only turn on plugins you trust. {manifest.author ? `By ${manifest.author}. ` : ""}Version{" "}
        {manifest.version}.
      </p>
    </FormDialog>
  );
}

function SettingControl({
  pluginId,
  setting,
  value,
}: {
  pluginId: string;
  setting: PluginSetting;
  value: PluginSettingValue;
}) {
  const change = useChange();
  const save = (next: PluginSettingValue) =>
    change.mutate(() =>
      callBridge("plugins.setSetting", { id: pluginId, key: setting.key, value: next }),
    );
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  switch (setting.type) {
    case "boolean":
      return (
        <Checkbox
          aria-label={setting.label}
          checked={value === true}
          onCheckedChange={(checked) => save(checked === true)}
        />
      );
    case "select":
      return (
        <Select value={String(value)} onValueChange={save}>
          <SelectTrigger aria-label={setting.label} className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {setting.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    default: {
      const commit = () => {
        if (setting.type === "number") {
          const number = Number(draft);
          if (Number.isFinite(number) && number !== value) save(number);
          else setDraft(String(value));
        } else if (draft !== value) save(draft);
      };
      return (
        <Input
          aria-label={setting.label}
          className="w-56"
          inputMode={setting.type === "number" ? "decimal" : undefined}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
        />
      );
    }
  }
}

const STATUS: Record<string, string> = {
  loading: "Starting…",
  running: "Running",
  failed: "Failed to start",
};

function PluginRow({ plugin, restricted }: { plugin: BridgePluginInfo; restricted: boolean }) {
  const host = usePluginHost();
  const change = useChange();
  const [asking, setAsking] = useState(false);

  if (!plugin.ok) {
    return (
      <SettingsRow
        title={plugin.folder}
        description={<span className="text-(--status-danger)">{plugin.error}</span>}
      />
    );
  }
  const { manifest } = plugin;
  const status = plugin.enabled
    ? restricted
      ? "Held back by restricted mode"
      : (STATUS[host.status[manifest.id] ?? ""] ?? "Off")
    : "Off";
  const log = host.logs[manifest.id] ?? [];
  // Permissions an update added, which the user hasn't allowed yet.
  const missing = manifest.permissions.filter((permission) => !plugin.granted.includes(permission));
  const shownSettings = manifest.settings.filter((setting) => !setting.hidden);

  return (
    <SettingsRow
      title={`${manifest.name} ${manifest.version}`}
      description={manifest.description}
      status={
        <span
          data-testid={`plugin-status-${manifest.id}`}
          className={host.status[manifest.id] === "failed" ? "text-(--status-danger)" : undefined}
        >
          {status}
        </span>
      }
      control={
        <Checkbox
          aria-label={`Turn on ${manifest.name}`}
          checked={plugin.enabled}
          disabled={change.isPending}
          onCheckedChange={(checked) =>
            checked === true
              ? setAsking(true)
              : change.mutate(() =>
                  callBridge("plugins.setEnabled", { id: manifest.id, enabled: false }),
                )
          }
        />
      }
    >
      {plugin.enabled && plugin.granted.includes("google:calendar") ? (
        <GoogleAccountSettings />
      ) : null}
      {plugin.enabled && missing.length && !restricted ? (
        <div className="flex items-center justify-between gap-4 pt-1">
          <div className="text-xs text-(--status-warning)">
            {`This version asks for more: ${missing.map((permission) => describePermission(permission as PluginPermission)).join(", ")}.`}
          </div>
          <Button variant="outline" size="sm" onClick={() => setAsking(true)}>
            Review
          </Button>
        </div>
      ) : null}
      {plugin.enabled && shownSettings.length ? (
        <div className="flex flex-col gap-2 pt-1">
          {shownSettings.map((setting) => (
            <div key={setting.key} className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs text-(--app-text)">{setting.label}</div>
                {setting.description ? (
                  <div className="text-[11px] text-(--app-muted)">{setting.description}</div>
                ) : null}
              </div>
              <SettingControl
                pluginId={manifest.id}
                setting={setting}
                value={settingValue(setting, plugin.settings)}
              />
            </div>
          ))}
        </div>
      ) : null}
      {log.length ? (
        <SettingsDetails label={`Log (${log.length})`}>
          <ul className="m-0 flex max-h-40 list-none flex-col gap-1 overflow-y-auto p-0 font-mono text-[11px]">
            {log.map((entry, index) => (
              <li
                key={index}
                className={
                  entry.level === "error" ? "text-(--status-danger)" : "text-(--app-muted)"
                }
              >
                {new Date(entry.at).toLocaleTimeString()} {entry.text}
              </li>
            ))}
          </ul>
        </SettingsDetails>
      ) : null}
      {asking ? (
        <PermissionDialog
          manifest={manifest}
          busy={change.isPending}
          onClose={() => setAsking(false)}
          onAllow={() =>
            change.mutate(
              () =>
                callBridge("plugins.setEnabled", {
                  id: manifest.id,
                  enabled: true,
                  granted: manifest.permissions,
                }),
              { onSettled: () => setAsking(false) },
            )
          }
        />
      ) : null}
    </SettingsRow>
  );
}

/** The plugins in the data folder, which run, and what each may do. */
export function PluginsSettings() {
  const plugins = usePlugins();
  const change = useChange();
  const list = plugins.data;
  const bundled = list?.plugins.filter((plugin) => plugin.bundled) ?? [];
  const installed = list?.plugins.filter((plugin) => !plugin.bundled) ?? [];

  return (
    <>
      <SettingsSection description="Plugins add commands, buttons, panels and slash menu items. Each runs on its own, away from the window, and can only do what you allow when you turn it on.">
        {plugins.isError ? (
          <SettingsNotice tone="danger">The plugins could not be read.</SettingsNotice>
        ) : null}
        <SettingsRow
          title="Restricted mode"
          description="While on, no plugin runs, even ones switched on below."
          control={
            <Checkbox
              aria-label="Restricted mode"
              checked={list?.restrictedMode ?? true}
              disabled={!list || change.isPending}
              onCheckedChange={(checked) =>
                change.mutate(() =>
                  callBridge("plugins.setRestricted", { restrictedMode: checked === true }),
                )
              }
            />
          }
        />
        <SettingsRow
          title="Plugins folder"
          description={
            list
              ? installed.length === 1
                ? "1 plugin"
                : `${installed.length} plugins`
              : "Reading…"
          }
          control={
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void pluginHost.reload({ restart: true }).then(() => plugins.refetch())
                }
              >
                <RefreshCwIcon className="size-3.5" aria-hidden />
                Reload
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void callBridge("plugins.reveal", {}).catch(() =>
                    toastError("The folder could not be opened."),
                  )
                }
              >
                <FolderOpenIcon className="size-3.5" aria-hidden />
                Open folder
              </Button>
            </div>
          }
        />
      </SettingsSection>
      {list && bundled.length ? (
        <SettingsSection title="Built in">
          {bundled.map((plugin) => (
            <PluginRow key={plugin.folder} plugin={plugin} restricted={list.restrictedMode} />
          ))}
        </SettingsSection>
      ) : null}
      {list && installed.length ? (
        <SettingsSection title="Installed">
          {installed.map((plugin) => (
            <PluginRow key={plugin.folder} plugin={plugin} restricted={list.restrictedMode} />
          ))}
        </SettingsSection>
      ) : null}
      <SettingsSection title="Making a plugin">
        <SettingsNote>
          A plugin is a folder in the plugins folder, named after its id, holding manifest.json and
          one bundled module that exports register(on, options). Hooks have the shape ($, e, next);
          $ is the only way to reach notes, the window and the network. Plugin files reload as you
          save them.
        </SettingsNote>
      </SettingsSection>
    </>
  );
}

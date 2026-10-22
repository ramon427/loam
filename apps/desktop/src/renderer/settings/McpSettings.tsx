import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { callBridge } from "../bridge";
import { Button } from "@loam/notes-ui/ui/Button";
import { Input } from "@loam/notes-ui/ui/Input";

import {
  SettingsDetails,
  SettingsNote,
  SettingsNotice,
  SettingsRow,
  SettingsSection,
  useSettingsBusy,
} from "./SettingsLayout";
import styles from "./settings.module.css";

const STATUS_KEY = ["mcp-status"];

/** Local consent, connection setup and revocation for AI clients. */
export function McpSettings() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: () => callBridge("mcp.status", {}) });
  const [portDraft, setPortDraft] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const port = portDraft ?? String(status.data?.port ?? 47821);
  const validPort = /^\d+$/.test(port) && Number(port) >= 1024 && Number(port) <= 65535;
  const configure = useMutation({
    mutationFn: (enabled: boolean) =>
      callBridge("mcp.configure", { enabled, ...(enabled ? { port: Number(port) } : {}) }),
    onSuccess: (next) => {
      queryClient.setQueryData(STATUS_KEY, next);
      setMessage(null);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
  });
  const copy = useMutation({
    mutationFn: async (transport: "http" | "stdio") => {
      const connection = await callBridge("mcp.connection", {});
      await navigator.clipboard.writeText(
        transport === "http" ? connection.config : connection.stdioConfig,
      );
      return transport;
    },
    onSuccess: (transport) =>
      setMessage(
        `${transport === "http" ? "HTTP" : "Stdio"} configuration copied. Paste it into your AI client's MCP settings.`,
      ),
  });
  const rotate = useMutation({
    mutationFn: () => callBridge("mcp.rotateToken", {}),
    onSuccess: () =>
      setMessage("Connection key replaced. Copy a new HTTP configuration for connected clients."),
  });
  const busy = configure.isPending || copy.isPending || rotate.isPending;
  useSettingsBusy(busy);
  const failure = configure.error ?? copy.error ?? rotate.error ?? status.error;
  return (
    <SettingsSection description="Let an AI client read and change your library through MCP, including backups and security settings. Loam must stay open.">
      {failure ? <SettingsNotice tone="danger">{failure.message}</SettingsNotice> : null}
      {status.data?.error ? (
        <SettingsNotice tone="danger">{status.data.error}</SettingsNotice>
      ) : null}
      <SettingsRow
        title="Access"
        description={
          status.data
            ? status.data.running
              ? "Running on this computer"
              : status.data.enabled
                ? "Could not start"
                : "Off"
            : "Loading…"
        }
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={!status.data || busy || (!status.data.enabled && !validPort)}
            onClick={() => configure.mutate(!status.data?.enabled)}
          >
            {status.data?.enabled ? "Turn off AI access" : "Enable AI access"}
          </Button>
        }
      />
      <SettingsRow
        title="Connect a client"
        description="Copy a configuration into your AI client's MCP settings."
        control={
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={!status.data?.running || busy}
              onClick={() => copy.mutate("http")}
            >
              Copy HTTP configuration
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!status.data?.running || busy}
              onClick={() => copy.mutate("stdio")}
            >
              Copy stdio configuration
            </Button>
          </>
        }
      />
      {message ? <SettingsNotice role="status">{message}</SettingsNotice> : null}
      <SettingsDetails label="Connection details">
        <SettingsRow
          title="Port"
          description="Between 1024 and 65535."
          control={
            <>
              <Input
                aria-label="MCP port"
                type="number"
                min={1024}
                max={65535}
                value={port}
                disabled={busy}
                onChange={(event) => setPortDraft(event.target.value)}
                className="w-28"
              />
              {status.data?.enabled ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !validPort}
                  onClick={() => configure.mutate(true)}
                >
                  Apply port / retry
                </Button>
              ) : null}
            </>
          }
        />
        {status.data?.url ? (
          <SettingsRow
            title="Endpoint"
            description={<code className={styles.path}>{status.data.url}</code>}
          />
        ) : null}
        <SettingsRow
          title="Connection key"
          description="Included in the HTTP configuration. Only share it with clients you want to give access."
          control={
            <Button
              size="sm"
              variant="outline"
              disabled={!status.data?.running || busy}
              onClick={() => rotate.mutate()}
            >
              Replace connection key
            </Button>
          }
        />
        <SettingsNote>
          The server accepts authenticated connections on this computer only. Turn access off to
          disconnect clients. Access settings and connection keys stay outside note sync and
          backups.
        </SettingsNote>
      </SettingsDetails>
    </SettingsSection>
  );
}

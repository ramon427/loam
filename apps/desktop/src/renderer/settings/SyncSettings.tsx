import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderOpenIcon, LockIcon, RefreshCwIcon } from "lucide-react";

import { saveAllNoteEditsOrThrow } from "../workspace/saveAllNoteEdits";
import { callBridge } from "../bridge";
import type { BridgeSyncStatus } from "@loam/shared/bridge/loamBridge";
import { Button } from "../ui/Button";
import { Notice } from "../ui/Notice";
import { toastError } from "../ui/toast";

import { PassphraseField } from "../security/PassphraseField";
import { errorMessage } from "../lib/errorMessage";
import { formatDateTime } from "../lib/format";
import { QUERY_KEYS, useSyncStatus } from "./queries";
import { SettingsNotice, SettingsRow, SettingsSection, useSettingsBusy } from "./SettingsLayout";
import styles from "./settings.module.css";

const describeState = (sync: BridgeSyncStatus) => {
  if (sync.state === "syncing") return "Syncing…";
  if (sync.state === "error") return "Not synced";
  return sync.lastSyncedAt ? `Synced ${formatDateTime(sync.lastSyncedAt)}` : "Waiting to sync";
};

const showError = (title: string) => (error: unknown) =>
  toastError(title, { description: errorMessage(error) });

/** Sync through a folder a cloud drive keeps in step across computers. */
export function SyncSettings() {
  const queryClient = useQueryClient();
  const status = useSyncStatus();
  const setStatus = (next: BridgeSyncStatus) =>
    queryClient.setQueryData(QUERY_KEYS.syncStatus, next);

  const choose = useMutation({
    mutationFn: () => callBridge("sync.chooseFolder", {}),
    onSuccess: (result) => (result.status === "chosen" ? setStatus(result.sync) : undefined),
    onError: showError("Sync not started"),
  });
  const runNow = useMutation({
    mutationFn: () => callBridge("sync.now", {}),
    onSuccess: setStatus,
    onError: showError("Sync failed"),
  });
  const turnOff = useMutation({
    mutationFn: () => callBridge("sync.turnOff", {}),
    onSuccess: setStatus,
    onError: showError("Sync not turned off"),
  });
  const [secret, setSecret] = useState("");
  const unlock = useMutation({
    mutationFn: async () => {
      await saveAllNoteEditsOrThrow();
      return callBridge("sync.unlockFolder", { secret });
    },
    onSuccess: (next) => {
      setSecret("");
      setStatus(next);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.securityStatus });
    },
  });
  const busy = choose.isPending || turnOff.isPending || unlock.isPending;
  useSettingsBusy(busy);

  const sync = status.data;
  const submitSecret = (event: FormEvent) => {
    event.preventDefault();
    if (secret && !busy) unlock.mutate();
  };

  return (
    <SettingsSection description="Keep your notes the same on all your computers by syncing through a folder that Dropbox, iCloud Drive, OneDrive or Syncthing already syncs. Pick a folder in it on each computer. Your notes never go through an Loam server.">
      {status.isError ? (
        <SettingsNotice tone="danger">Could not read the sync settings.</SettingsNotice>
      ) : null}
      {sync?.error ? <SettingsNotice tone="danger">{sync.error}</SettingsNotice> : null}
      {sync?.needsPassphrase ? (
        <form className={styles.syncUnlock} onSubmit={submitSecret}>
          <p className={styles.status}>
            Enter the passphrase you use on your other computers, or the recovery key. Your notes on
            this computer are then encrypted with it too, and Loam asks for it at each start.
          </p>
          <PassphraseField
            className={styles.syncUnlockPassphrase}
            label="Passphrase or recovery key"
            value={secret}
            onChange={setSecret}
            disabled={unlock.isPending}
          />
          {unlock.isError ? <Notice tone="danger">{errorMessage(unlock.error)}</Notice> : null}
          {unlock.isPending ? (
            <Notice role="status">Encrypting your notes with the sync folder's passphrase…</Notice>
          ) : null}
          <Button type="submit" variant="outline" size="sm" disabled={!secret || busy}>
            <LockIcon className="size-4" aria-hidden="true" />
            {unlock.isPending ? "Unlocking…" : "Unlock and sync"}
          </Button>
        </form>
      ) : null}
      <SettingsRow
        title="Sync folder"
        description={
          sync?.folder ? (
            <code className={styles.path} data-testid="settings-sync-folder">
              {sync.folder}
            </code>
          ) : sync ? (
            "Off"
          ) : (
            "…"
          )
        }
        control={
          <Button
            variant="outline"
            size="sm"
            disabled={!sync || busy}
            onClick={() => choose.mutate()}
          >
            <FolderOpenIcon className="size-4" aria-hidden="true" />
            {sync?.folder ? "Change folder…" : "Choose folder…"}
          </Button>
        }
      />
      {sync?.folder ? (
        <>
          <SettingsRow
            title="Status"
            description={
              <span role="status" data-testid="settings-sync-state">
                {describeState(sync)}
                {sync.unpublished > 0
                  ? ` · ${sync.unpublished} ${sync.unpublished === 1 ? "change" : "changes"} to send`
                  : ""}
              </span>
            }
            control={
              <Button
                variant="outline"
                size="sm"
                disabled={busy || sync.state === "syncing" || runNow.isPending}
                onClick={() => runNow.mutate()}
              >
                <RefreshCwIcon className="size-4" aria-hidden="true" />
                Sync now
              </Button>
            }
          />
          <SettingsRow
            title="Turn off"
            description="Notes stay on this computer and in the sync folder."
            control={
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => turnOff.mutate()}>
                Turn off sync
              </Button>
            }
          />
        </>
      ) : null}
    </SettingsSection>
  );
}

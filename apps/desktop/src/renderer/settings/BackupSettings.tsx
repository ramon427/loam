import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SaveIcon, FolderOpenIcon, RotateCcwIcon } from "lucide-react";

import type {
  BridgeBackup,
  BridgeBackupKind,
  LoamBridgeResult,
} from "@loam/shared/bridge/loamBridge";
import { BridgeError } from "@loam/notes-ui/host/notesHost";

import { callBridge } from "../bridge";
import { errorMessage } from "@loam/notes-ui/lib/errorMessage";
import { formatDateTime, formatSize } from "@loam/notes-ui/lib/format";
import { PassphraseField } from "../security/PassphraseField";
import { Button } from "@loam/notes-ui/ui/Button";
import { DestructiveConfirmDialog } from "@loam/notes-ui/ui/DestructiveConfirmDialog";
import { toastError, toastSuccess } from "@loam/notes-ui/ui/toast";
import { saveAllNoteEdits, UNSAVED_EDITS_MESSAGE } from "@loam/notes-ui/workspace/saveAllNoteEdits";

import { FormDialog } from "./FormDialog";
import { QUERY_KEYS, useBackups } from "./queries";
import styles from "./settings.module.css";
import {
  SettingsDetails,
  SettingsNote,
  SettingsNotice,
  SettingsRow,
  SettingsSection,
  useSettingsBusy,
} from "./SettingsLayout";

const KIND_LABELS: Record<BridgeBackupKind, string> = {
  auto: "Daily",
  manual: "Manual",
  "before-restore": "Before a restore",
  "before-import": "Before an import",
  "before-encryption": "Before encryption changed",
};

/** Restores a backup; `secret` opens one encrypted with another passphrase. */
type Restore = (
  secret?: string,
) => Promise<LoamBridgeResult<"backups.restore" | "backups.restoreFile">>;

/** A restore waiting for the passphrase of the encrypted backup it reads. */
type LockedRestore = { message: string; restore: Restore };

/** Daily backups of the whole library, and restoring one. */
export function BackupSettings() {
  const queryClient = useQueryClient();
  const backups = useBackups();
  const backUpNow = useMutation({
    mutationFn: () => callBridge("backups.create", {}),
    onSuccess: () => {
      toastSuccess("Backed up");
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.backups });
    },
    onError: (error) => toastError("Backup failed", { description: errorMessage(error) }),
  });
  const openFolder = useMutation({
    mutationFn: () => callBridge("backups.openFolder", {}),
    onError: (error) =>
      toastError("Could not open the backups folder", { description: errorMessage(error) }),
  });
  const [confirming, setConfirming] = useState<BridgeBackup | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [locked, setLocked] = useState<LockedRestore | null>(null);
  useSettingsBusy(restoring || backUpNow.isPending);

  /** Saves open edits, then restores; on success the app restarts by itself. */
  const runRestore = async (restore: Restore, secret?: string) => {
    setRestoring(true);
    try {
      if (!(await saveAllNoteEdits())) {
        toastError("Restore not started", { description: UNSAVED_EDITS_MESSAGE });
        setRestoring(false);
        return;
      }
      const result = await restore(secret);
      if ("status" in result && result.status === "canceled") setRestoring(false);
    } catch (error) {
      setRestoring(false);
      if (error instanceof BridgeError && error.code === "BACKUP_LOCKED") {
        setLocked({ message: error.message, restore });
        return;
      }
      toastError("Restore failed", { description: errorMessage(error) });
    }
  };

  const list = backups.data?.backups ?? [];
  const newest = list.find((backup) => backup.kind === "auto" || backup.kind === "manual");

  return (
    <SettingsSection description="Your library is backed up daily and before imports or restores. You can make a backup at any time.">
      {backups.isError ? (
        <SettingsNotice tone="danger">Could not read the backups folder.</SettingsNotice>
      ) : null}
      {backups.data?.lastError ? (
        <SettingsNotice tone="danger">
          The last backup failed: {backups.data.lastError}
        </SettingsNotice>
      ) : null}
      {restoring ? (
        <SettingsNotice role="status">Restoring… Loam restarts in a moment.</SettingsNotice>
      ) : null}
      <SettingsRow
        title="Last backup"
        description={newest ? formatDateTime(newest.createdAt) : backups.data ? "None yet" : "…"}
        control={
          <Button
            variant="outline"
            size="sm"
            disabled={backUpNow.isPending || restoring}
            onClick={() => backUpNow.mutate()}
          >
            <SaveIcon className="size-4" aria-hidden="true" />
            {backUpNow.isPending ? "Backing up…" : "Back up now"}
          </Button>
        }
      />
      <SettingsRow
        title="Restore"
        description={
          list.length === 0
            ? "No backups yet. You can still restore a backup file."
            : "Bring back the library as it was in a backup."
        }
        control={
          <Button
            variant="outline"
            size="sm"
            disabled={restoring}
            onClick={() =>
              void runRestore((secret) => callBridge("backups.restoreFile", { secret }))
            }
          >
            Restore from a file…
          </Button>
        }
      >
        {list.length === 0 ? null : (
          <div className={styles.backupList}>
            <ul aria-label="Backups">
              {list.map((backup) => (
                <li key={backup.id}>
                  <span>{formatDateTime(backup.createdAt)}</span>
                  <span className={styles.status}>
                    {KIND_LABELS[backup.kind]} · {formatSize(backup.sizeBytes)}
                  </span>
                  <Button
                    className={styles.backupRestore}
                    variant="ghost"
                    size="sm"
                    disabled={restoring}
                    onClick={() => setConfirming(backup)}
                  >
                    <RotateCcwIcon className="size-4" aria-hidden="true" />
                    Restore…
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </SettingsRow>
      <SettingsDetails label="Backup details">
        <SettingsRow
          title="Backups folder"
          description={<code className={styles.path}>{backups.data?.directory ?? "…"}</code>}
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={!backups.data || openFolder.isPending}
              onClick={() => openFolder.mutate()}
            >
              <FolderOpenIcon className="size-4" aria-hidden="true" />
              Open folder
            </Button>
          }
        />
        <SettingsNote>
          Loam keeps the last 7 days, 4 weekly backups, and the last 5 taken before an import or
          restore.
        </SettingsNote>
      </SettingsDetails>
      <DestructiveConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => (open ? undefined : setConfirming(null))}
        title="Restore this backup?"
        target={confirming ? `The backup from ${formatDateTime(confirming.createdAt)}` : ""}
        currentState="Your notes as they are"
        nextState="Your notes as they were in this backup"
        blastRadius="Every note and folder is replaced, then Loam restarts. Your current notes are backed up first, so restoring that backup undoes this."
        confirmLabel="Restore"
        onConfirm={() => {
          const backup = confirming;
          setConfirming(null);
          if (backup)
            void runRestore((secret) =>
              callBridge("backups.restore", { backupId: backup.id, secret }),
            );
        }}
      />
      {locked ? (
        <BackupPassphraseDialog
          message={locked.message}
          onCancel={() => setLocked(null)}
          onSubmit={(secret) => {
            setLocked(null);
            void runRestore(locked.restore, secret);
          }}
        />
      ) : null}
    </SettingsSection>
  );
}

/** Asks for the passphrase or recovery key of an encrypted backup being restored. */
function BackupPassphraseDialog({
  message,
  onCancel,
  onSubmit,
}: {
  message: string;
  onCancel: () => void;
  onSubmit: (secret: string) => void;
}) {
  const [secret, setSecret] = useState("");
  return (
    <FormDialog
      title="This backup is encrypted"
      description={message}
      onClose={onCancel}
      onSubmit={() => (secret ? onSubmit(secret) : undefined)}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!secret}>
            Restore
          </Button>
        </>
      }
    >
      <PassphraseField
        label="Passphrase or recovery key"
        value={secret}
        onChange={setSecret}
        autoFocus
      />
    </FormDialog>
  );
}

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, SaveIcon, LockIcon, LockOpenIcon } from "lucide-react";

import { callBridge } from "../bridge";
import { saveAllNoteEditsOrThrow } from "../workspace/saveAllNoteEdits";
import type { BridgeSecurityStatus } from "@loam/shared/bridge/loamBridge";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Label } from "../ui/Label";
import { Notice } from "../ui/Notice";
import { toastError, toastSuccess } from "../ui/toast";

import { errorMessage } from "../lib/errorMessage";
import { newPassphraseProblem, PassphraseField } from "../security/PassphraseField";
import { FormDialog } from "./FormDialog";
import { QUERY_KEYS, useSecurityStatus } from "./queries";
import { SettingsNotice, SettingsRow, SettingsSection, useSettingsBusy } from "./SettingsLayout";
import styles from "../security/security.module.css";

/** Encrypting notes with a passphrase, changing it, and turning encryption off. */
export function SecuritySettings() {
  const queryClient = useQueryClient();
  const status = useSecurityStatus();
  const [dialog, setDialog] = useState<"enable" | "change" | "disable" | null>(null);
  const setStatus = (next: BridgeSecurityStatus) => {
    queryClient.setQueryData(QUERY_KEYS.securityStatus, next);
    // Sync and backups show encryption too.
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.syncStatus });
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.backups });
  };
  const close = () => setDialog(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.securityStatus });
  const on = status.data?.state === "on";

  return (
    <SettingsSection description="Encrypt your notes so that only your passphrase opens them: on this computer, in backups and in your sync folder. Loam asks for the passphrase each time it starts.">
      {status.isError ? (
        <SettingsNotice tone="danger">Could not read the encryption settings.</SettingsNotice>
      ) : null}
      <SettingsRow
        title="Encryption"
        description={
          <span data-testid="settings-encryption-state">
            {!status.data ? "…" : on ? "On" : "Off"}
          </span>
        }
        control={
          status.data && !on ? (
            <Button variant="outline" size="sm" onClick={() => setDialog("enable")}>
              <LockIcon className="size-4" aria-hidden="true" />
              Encrypt my notes…
            </Button>
          ) : null
        }
      />
      {on ? (
        <>
          <SettingsRow
            title="Passphrase"
            control={
              <Button variant="outline" size="sm" onClick={() => setDialog("change")}>
                Change passphrase…
              </Button>
            }
          />
          <SettingsRow
            title="Turn off"
            description="Notes are stored unencrypted again on this computer."
            control={
              <Button variant="ghost" size="sm" onClick={() => setDialog("disable")}>
                <LockOpenIcon className="size-4" aria-hidden="true" />
                Turn off encryption…
              </Button>
            }
          />
        </>
      ) : null}
      {dialog === "enable" ? (
        <EnableEncryptionDialog onClose={close} onDone={setStatus} onFailed={refresh} />
      ) : null}
      {dialog === "change" ? <ChangePassphraseDialog onClose={close} /> : null}
      {dialog === "disable" ? (
        <DisableEncryptionDialog onClose={close} onDone={setStatus} onFailed={refresh} />
      ) : null}
    </SettingsSection>
  );
}

type DialogProps = {
  onClose: () => void;
  onDone: (status: BridgeSecurityStatus) => void;
  /** A failure may have changed encryption part way; read where it stands again. */
  onFailed: () => void;
};

function EnableEncryptionDialog({ onClose, onDone, onFailed }: DialogProps) {
  const [step, setStep] = useState<"passphrase" | "recovery-key">("passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const showKey = useMutation({
    mutationFn: () => callBridge("security.newRecoveryKey", {}),
    onSuccess: ({ recoveryKey: key }) => {
      setRecoveryKey(key);
      setStep("recovery-key");
    },
    onError: (error) => setProblem(errorMessage(error)),
  });
  const saveToFile = useMutation({
    mutationFn: () => callBridge("security.saveRecoveryKey", {}),
    onError: (error) => toastError("Not saved", { description: errorMessage(error) }),
  });
  const encrypt = useMutation({
    mutationFn: async () => {
      await saveAllNoteEditsOrThrow();
      return callBridge("security.enable", { passphrase, recoveryKey: recoveryKey ?? "" });
    },
    onSuccess: (status) => {
      onDone(status);
      onClose();
      toastSuccess("Your notes are encrypted", {
        description: "Loam will ask for your passphrase each time it starts.",
      });
    },
    onError: (error) => {
      setProblem(errorMessage(error));
      onFailed();
    },
  });
  useSettingsBusy(encrypt.isPending);

  const copy = async () => {
    if (!recoveryKey) return;
    try {
      await navigator.clipboard.writeText(recoveryKey);
      toastSuccess("Recovery key copied");
    } catch {
      toastError("Couldn't copy the recovery key", { description: "Save it as a file instead." });
    }
  };

  if (step === "passphrase")
    return (
      <FormDialog
        title="Encrypt your notes"
        description="Choose a passphrase. You'll enter it each time Loam starts."
        busy={showKey.isPending}
        onClose={onClose}
        onSubmit={() => {
          const issue = newPassphraseProblem(passphrase, confirmation);
          setProblem(issue);
          if (!issue) showKey.mutate();
        }}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={showKey.isPending}>
              Continue
            </Button>
          </>
        }
      >
        <PassphraseField
          label="Passphrase"
          value={passphrase}
          onChange={setPassphrase}
          autoComplete="new-password"
          autoFocus
        />
        <PassphraseField
          label="Passphrase again"
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
        />
        <Notice tone="warning">
          If you forget your passphrase and lose your recovery key, your notes can't be opened
          again, by you or by anyone else. Nobody, including Loam, can reset it for you.
        </Notice>
        {problem ? <Notice tone="danger">{problem}</Notice> : null}
      </FormDialog>
    );

  return (
    <FormDialog
      title="Save your recovery key"
      description="If you forget your passphrase, this key is the only way to open your notes. Save it or write it down, and keep it away from this computer."
      busy={encrypt.isPending}
      onClose={onClose}
      onSubmit={() => {
        setProblem(null);
        encrypt.mutate();
      }}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            disabled={encrypt.isPending}
            onClick={() => {
              setStep("passphrase");
              setSaved(false);
              setProblem(null);
            }}
          >
            Back
          </Button>
          <Button type="submit" disabled={!saved || encrypt.isPending}>
            {encrypt.isPending ? "Encrypting…" : "Encrypt my notes"}
          </Button>
        </>
      }
    >
      <code className={styles.recoveryKey} data-testid="recovery-key">
        {recoveryKey}
      </code>
      <div className={styles.recoveryKeyActions}>
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          <CopyIcon className="size-4" aria-hidden="true" />
          Copy
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saveToFile.isPending}
          onClick={() => saveToFile.mutate()}
        >
          <SaveIcon className="size-4" aria-hidden="true" />
          Save as a file…
        </Button>
      </div>
      <Label className={styles.recoveryKeyConfirm}>
        <Checkbox
          checked={saved}
          disabled={encrypt.isPending}
          onCheckedChange={(checked) => setSaved(checked === true)}
        />
        I saved my recovery key somewhere safe
      </Label>
      {encrypt.isPending ? (
        <Notice role="status">
          Encrypting your notes, images and backups. This can take a minute.
        </Notice>
      ) : null}
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
    </FormDialog>
  );
}

function ChangePassphraseDialog({ onClose }: Pick<DialogProps, "onClose">) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: () => callBridge("security.changePassphrase", { current, next }),
    onSuccess: () => {
      onClose();
      toastSuccess("Passphrase changed", { description: "Your recovery key still works." });
    },
    onError: (error) => setProblem(errorMessage(error)),
  });
  useSettingsBusy(change.isPending);
  return (
    <FormDialog
      title="Change passphrase"
      description="Your notes stay encrypted with the same key; only the passphrase that unlocks it changes."
      busy={change.isPending}
      onClose={onClose}
      onSubmit={() => {
        const issue = current ? newPassphraseProblem(next, confirmation) : "Enter your passphrase.";
        setProblem(issue);
        if (!issue) change.mutate();
      }}
      footer={
        <>
          <Button type="button" variant="ghost" disabled={change.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={change.isPending}>
            {change.isPending ? "Changing…" : "Change passphrase"}
          </Button>
        </>
      }
    >
      <PassphraseField label="Current passphrase" value={current} onChange={setCurrent} autoFocus />
      <PassphraseField
        label="New passphrase"
        value={next}
        onChange={setNext}
        autoComplete="new-password"
      />
      <PassphraseField
        label="New passphrase again"
        value={confirmation}
        onChange={setConfirmation}
        autoComplete="new-password"
      />
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
    </FormDialog>
  );
}

function DisableEncryptionDialog({ onClose, onDone, onFailed }: DialogProps) {
  const [passphrase, setPassphrase] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const disable = useMutation({
    mutationFn: async () => {
      await saveAllNoteEditsOrThrow();
      return callBridge("security.disable", { passphrase });
    },
    onSuccess: (status) => {
      onDone(status);
      onClose();
      toastSuccess("Encryption is off");
    },
    onError: (error) => {
      setProblem(errorMessage(error));
      onFailed();
    },
  });
  useSettingsBusy(disable.isPending);
  return (
    <FormDialog
      title="Turn off encryption?"
      description="Your notes and images are stored unencrypted on this computer again, and new backups aren't encrypted."
      busy={disable.isPending}
      onClose={onClose}
      onSubmit={() => {
        setProblem(passphrase ? null : "Enter your passphrase.");
        if (passphrase) disable.mutate();
      }}
      footer={
        <>
          <Button type="button" variant="ghost" disabled={disable.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" disabled={disable.isPending}>
            {disable.isPending ? "Turning off…" : "Turn off encryption"}
          </Button>
        </>
      }
    >
      <PassphraseField label="Passphrase" value={passphrase} onChange={setPassphrase} autoFocus />
      <Notice tone="warning">
        Sync is turned off on this computer: your sync folder stays encrypted for your other
        computers. Backups made while encryption was on still need this passphrase to restore.
      </Notice>
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
    </FormDialog>
  );
}

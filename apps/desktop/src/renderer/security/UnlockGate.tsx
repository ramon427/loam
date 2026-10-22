import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LockIcon } from "lucide-react";

import type { BridgeSecurityStatus } from "@loam/shared/bridge/loamBridge";
import { callBridge } from "../bridge";
import { Button } from "@loam/notes-ui/ui/Button";
import { Input } from "@loam/notes-ui/ui/Input";
import { Label } from "@loam/notes-ui/ui/Label";
import { Notice } from "@loam/notes-ui/ui/Notice";

import { TitleBar } from "../shell/TitleBar";
import { errorMessage } from "@loam/notes-ui/lib/errorMessage";
import { QUERY_KEYS, useSecurityStatus } from "../settings/queries";
import { newPassphraseProblem, PassphraseField } from "./PassphraseField";
import styles from "./security.module.css";

/** Shows the app once the notes are open; asks for the passphrase while they are locked. */
export function UnlockGate({ children }: { children: ReactNode }) {
  const status = useSecurityStatus();
  if (status.isError)
    return (
      <LockedWindow>
        <Notice tone="danger">
          Loam couldn't tell whether your notes are encrypted. Restart the app.
        </Notice>
      </LockedWindow>
    );
  if (!status.data) return <LockedWindow />;
  if (status.data.state === "locked") return <UnlockScreen />;
  return children;
}

function LockedWindow({ children }: { children?: ReactNode }) {
  return (
    <div className="loam-window">
      <TitleBar />
      <main className={styles.unlock}>{children}</main>
    </div>
  );
}

function UnlockScreen() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"passphrase" | "recovery">("passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const opened = (status: BridgeSecurityStatus) =>
    queryClient.setQueryData(QUERY_KEYS.securityStatus, status);
  const unlock = useMutation({
    mutationFn: () => callBridge("security.unlock", { passphrase }),
    onSuccess: opened,
    onError: (error) => {
      setProblem(errorMessage(error));
      setPassphrase("");
    },
  });
  const reset = useMutation({
    mutationFn: () =>
      callBridge("security.resetPassphrase", { recoveryKey, passphrase: newPassphrase }),
    onSuccess: opened,
    onError: (error) => setProblem(errorMessage(error)),
  });
  const busy = unlock.isPending || reset.isPending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (mode === "passphrase") {
      if (!passphrase) return;
      setProblem(null);
      unlock.mutate();
      return;
    }
    const issue = recoveryKey.trim()
      ? newPassphraseProblem(newPassphrase, confirmation)
      : "Enter your recovery key.";
    setProblem(issue);
    if (!issue) reset.mutate();
  };

  const switchMode = (next: typeof mode) => {
    setMode(next);
    setProblem(null);
  };

  return (
    <LockedWindow>
      <form className={styles.unlockCard} onSubmit={submit} aria-labelledby="loam-unlock-title">
        <LockIcon className={styles.unlockIcon} aria-hidden="true" />
        <h1 id="loam-unlock-title" className={styles.unlockTitle}>
          Your notes are locked
        </h1>
        {mode === "passphrase" ? (
          <>
            <p className={styles.unlockText}>Enter your passphrase to open them.</p>
            <PassphraseField
              label="Passphrase"
              value={passphrase}
              onChange={setPassphrase}
              autoFocus
              disabled={busy}
            />
          </>
        ) : (
          <>
            <p className={styles.unlockText}>
              Enter the recovery key you saved when you turned on encryption, and choose a new
              passphrase.
            </p>
            <RecoveryKeyField value={recoveryKey} onChange={setRecoveryKey} disabled={busy} />
            <PassphraseField
              label="New passphrase"
              value={newPassphrase}
              onChange={setNewPassphrase}
              autoComplete="new-password"
              disabled={busy}
            />
            <PassphraseField
              label="New passphrase again"
              value={confirmation}
              onChange={setConfirmation}
              autoComplete="new-password"
              disabled={busy}
            />
          </>
        )}
        {problem ? <Notice tone="danger">{problem}</Notice> : null}
        <Button type="submit" size="full" disabled={busy}>
          {busy ? "Unlocking…" : mode === "passphrase" ? "Unlock" : "Unlock and save passphrase"}
        </Button>
        <Button
          type="button"
          className={styles.unlockModeSwitch}
          variant="link"
          size="sm"
          disabled={busy}
          onClick={() => switchMode(mode === "passphrase" ? "recovery" : "passphrase")}
        >
          {mode === "passphrase" ? "Forgot your passphrase?" : "Use your passphrase instead"}
        </Button>
      </form>
    </LockedWindow>
  );
}

function RecoveryKeyField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={styles.passphraseField}>
      <Label htmlFor={id}>Recovery key</Label>
      <Input
        id={id}
        value={value}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
        className={styles.recoveryKeyInput}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

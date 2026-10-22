import { useId } from "react";

import { Input } from "@loam/notes-ui/ui/Input";
import { cn } from "@loam/notes-ui/ui/cn";
import { Label } from "@loam/notes-ui/ui/Label";

import styles from "./security.module.css";

/** A labelled password field; the passphrase never leaves the form until it is sent. */
export function PassphraseField({
  label,
  value,
  onChange,
  autoFocus,
  autoComplete = "current-password",
  disabled,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  autoComplete?: "current-password" | "new-password" | "off";
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn(styles.passphraseField, className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        value={value}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        spellCheck={false}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

const MIN_PASSPHRASE_LENGTH = 8;

/** Why a new passphrase can't be used yet, or null when it can. */
export const newPassphraseProblem = (passphrase: string, confirmation: string) => {
  if (Array.from(passphrase).length < MIN_PASSPHRASE_LENGTH)
    return `Use at least ${MIN_PASSPHRASE_LENGTH} characters.`;
  if (passphrase !== confirmation) return "The two passphrases don't match.";
  return null;
};

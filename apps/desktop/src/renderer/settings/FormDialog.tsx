import type { FormEvent, ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/Dialog";

import styles from "./settings.module.css";

/** A small dialog holding one form; it can't be closed while its request runs. */
export function FormDialog({
  title,
  description,
  busy = false,
  onClose,
  onSubmit,
  children,
  footer,
}: {
  title: string;
  description: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) onSubmit();
  };
  return (
    <Dialog open onOpenChange={(open) => (open || busy ? undefined : onClose())}>
      <DialogContent className={styles.formDialog} showCloseButton={!busy}>
        <form onSubmit={submit} className={styles.form}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          <DialogFooter>{footer}</DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import type * as React from "react";

import { Button } from "./Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./Dialog";

function ConfirmDetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-[11px] font-medium text-(--app-muted)">{label}</dt>
      <dd className="min-w-0 text-xs text-(--app-text)">{value}</dd>
    </div>
  );
}

/** Asks before an irreversible change, spelling out what it touches. */
export function DestructiveConfirmDialog({
  open,
  onOpenChange,
  title,
  target,
  currentState,
  nextState,
  blastRadius,
  confirmLabel,
  onConfirm,
  confirmPending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  target: React.ReactNode;
  currentState: React.ReactNode;
  nextState: React.ReactNode;
  blastRadius: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  confirmPending?: boolean;
}) {
  const handleOpenChange = (nextOpen: boolean) => {
    if (confirmPending && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className="text-(--app-text)">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Confirm a destructive change. Review the target, current state, next state, and blast
            radius before continuing.
          </DialogDescription>
        </DialogHeader>

        <dl className="space-y-2 text-xs">
          <ConfirmDetailRow label="What" value={target} />
          <ConfirmDetailRow label="Now" value={currentState} />
          <ConfirmDetailRow label="After" value={nextState} />
          <ConfirmDetailRow label="What changes" value={blastRadius} />
        </dl>

        <DialogFooter>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={confirmPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            disabled={confirmPending}
            aria-busy={confirmPending || undefined}
          >
            {confirmPending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

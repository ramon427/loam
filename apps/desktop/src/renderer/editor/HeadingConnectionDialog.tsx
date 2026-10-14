import { ArrowUpRightIcon, CheckIcon, LinkIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/Dialog";

/*
 * The parts both heading connection dialogs share: picking headings for a
 * graph node or table entry, and picking graph nodes and table entries for a
 * heading.
 */

export function HeadingConnectionDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(42rem,calc(100svh-2rem))] max-w-xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-(--app-border)/70 px-5 py-4 pr-12">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-xs">{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export const matchesSearch = (values: readonly string[], query: string) => {
  const normalized = query.trim().toLocaleLowerCase();
  return (
    normalized.length === 0 ||
    values.some((value) => value.toLocaleLowerCase().includes(normalized))
  );
};

/** One heading or target in a connection list: a toggle, and a button to open it. */
export function HeadingConnectionOption({
  checked,
  disabled,
  detail,
  indent = 0,
  label,
  onOpen,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  detail: string;
  indent?: number;
  label: string;
  onOpen: () => void;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-2" style={{ paddingLeft: Math.max(0, indent) * 12 }}>
      <Button
        variant="ghost"
        className="h-auto min-h-11 min-w-0 flex-1 justify-start gap-2 whitespace-normal px-2 py-1 text-left"
        disabled={disabled}
        aria-label={(checked ? "Disconnect " : "Connect ") + label}
        aria-pressed={checked}
        onClick={onToggle}
      >
        <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">
          {checked ? <CheckIcon className="size-4" /> : null}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium">{label}</span>
          <span className="block truncate text-[11px] text-(--app-muted)">{detail}</span>
        </span>
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={"Open " + label} onClick={onOpen}>
        <ArrowUpRightIcon />
      </Button>
    </div>
  );
}

/** What a connection list shows when it has nothing to list. */
export function HeadingConnectionListEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-(--app-border)/70 px-6 text-center">
      <LinkIcon aria-hidden="true" className="size-5 text-(--app-muted)" />
      <p className="text-xs font-medium text-(--app-text)">{children}</p>
    </div>
  );
}

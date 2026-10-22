import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "./cn";

const toneClass = {
  danger:
    "border-[color-mix(in_srgb,var(--status-danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--status-danger)_8%,transparent)] text-(--status-danger)",
  warning:
    "border-[color-mix(in_srgb,var(--status-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--status-warning)_8%,transparent)] text-(--status-warning)",
};

export type NoticeProps = Omit<ComponentPropsWithoutRef<"div">, "children" | "role"> & {
  children: ReactNode;
  /** Defaults to `alert` for danger and to none otherwise; pass `status` for progress. */
  role?: "alert" | "status";
  /** A problem (danger) or a risk to keep in mind (warning); plain text without one. */
  tone?: keyof typeof toneClass;
};

/** A short message inside a screen or dialog. */
export function Notice({ children, className, role, tone, ...props }: NoticeProps) {
  return (
    <div
      role={role ?? (tone === "danger" ? "alert" : undefined)}
      data-slot="notice"
      className={cn(
        "text-(--app-text)",
        tone && cn("rounded-(--radius-control) border px-2.5 py-2", toneClass[tone]),
        className,
      )}
      {...props}
    >
      <p className="text-xs">{children}</p>
    </div>
  );
}

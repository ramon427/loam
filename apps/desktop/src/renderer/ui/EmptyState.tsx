import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "./cn";

type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  title: string;
  titleAs?: "p" | "h1";
  description?: ReactNode;
  action?: ReactNode;
  size?: "sm" | "md";
  slotClassNames?: Partial<Record<"title" | "description" | "action", string>>;
};

export const EmptyState = ({
  title,
  titleAs: TitleTag = "p",
  description,
  action,
  size = "md",
  className,
  slotClassNames,
  ...props
}: EmptyStateProps) => (
  <div
    className={cn(
      "flex w-full min-w-0 flex-col items-center justify-center gap-2 border border-transparent text-center",
      size === "sm" ? "p-4" : "p-6",
      className,
    )}
    {...props}
  >
    <TitleTag
      className={cn(
        "mx-auto max-w-sm text-sm leading-5 font-bold text-(--app-text)",
        slotClassNames?.title,
      )}
    >
      {title}
    </TitleTag>
    {description ? (
      <p
        className={cn(
          "mx-auto max-w-sm text-xs leading-normal font-normal text-balance text-(--app-muted)",
          slotClassNames?.description,
        )}
      >
        {description}
      </p>
    ) : null}
    {action ? (
      <div
        className={cn(
          "mt-2 flex w-full max-w-sm flex-wrap justify-center gap-2.5",
          slotClassNames?.action,
        )}
      >
        {action}
      </div>
    ) : null}
  </div>
);

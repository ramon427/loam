import { useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "./cn";
import {
  CONTROL_TRANSITION_TIMING_CLASS,
  DISABLED_CONTROL_CLASS,
  FOCUS_RING_CLASS,
  HIT_TARGET_MIN_CLASS,
} from "../styles/controlInteraction";

const panelTabItemClass = cn(
  "inline-flex h-7 shrink-0 touch-manipulation cursor-pointer items-center justify-center rounded-[var(--raised-control-radius)] px-3 py-1.5 text-[13px] font-medium transition-[color,background-color,border-color,box-shadow,opacity] motion-reduce:transition-none",
  CONTROL_TRANSITION_TIMING_CLASS,
  HIT_TARGET_MIN_CLASS,
  FOCUS_RING_CLASS,
  DISABLED_CONTROL_CLASS,
);

type PanelTabItem = {
  id: string;
  label: ReactNode;
  disabled?: boolean;
};

export function PanelTabs({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: readonly PanelTabItem[];
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusValue = items.some((item) => item.id === value && !item.disabled)
    ? value
    : items.find((item) => !item.disabled)?.id;

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const enabledItems = items.filter((item) => !item.disabled);
    if (enabledItems.length === 0) return;

    const currentId = items[currentIndex]?.id;
    const enabledIndex = enabledItems.findIndex((item) => item.id === currentId);
    const nextItem = (() => {
      if (event.key === "Home") return enabledItems[0];
      if (event.key === "End") return enabledItems[enabledItems.length - 1];
      if (event.key === "ArrowRight") {
        return enabledItems[(enabledIndex + 1 + enabledItems.length) % enabledItems.length];
      }
      return enabledItems[(enabledIndex - 1 + enabledItems.length) % enabledItems.length];
    })();

    if (nextItem) tabRefs.current.get(nextItem.id)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex min-w-0 max-w-full flex-wrap items-center gap-1 overflow-x-auto overscroll-x-contain py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item, index) => {
        const isActive = item.id === value;
        return (
          <button
            key={item.id}
            ref={(node) => {
              if (node) tabRefs.current.set(item.id, node);
              else tabRefs.current.delete(item.id);
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={item.id === focusValue ? 0 : -1}
            disabled={item.disabled}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onClick={() => {
              if (item.disabled || isActive) return;
              onChange(item.id);
            }}
            className={cn(
              panelTabItemClass,
              isActive
                ? "bg-(--app-page-2) text-(--app-text)"
                : "text-(--app-muted)/60 hover:bg-(--app-page-2)/60 hover:text-(--app-text)",
            )}
          >
            <span className="w-full text-center">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

import * as React from "react";

import { cn } from "./cn";
import { matchesShortcut, shortcuts } from "../keyboard/shortcuts";
import { controlSurfaceClass } from "../styles/controlSurface";
import {
  CONTROL_TRANSITION_TIMING_CLASS,
  DISABLED_CONTROL_CLASS,
  NESTED_FOCUS_RESET_CLASS,
  HIT_TARGET_CLASS,
} from "../styles/controlInteraction";

type InputProps = React.ComponentPropsWithRef<"input"> & {
  /** Leave the field on Enter or Ctrl/Cmd+S, the keys that finish an edit (default true). */
  exitOnCommitKeys?: boolean;
  surface?: "raised" | "plain";
};

/**
 * Leaves the field on Ctrl/Cmd+S, and on Enter unless a key handler took it or the field is in
 * a form, where Enter submits.
 */
const exitOnCommitKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
  const input = event.currentTarget;
  if (input.type === "file") return;
  if (matchesShortcut(event.nativeEvent, shortcuts["entry.save"])) {
    input.blur();
    return;
  }
  if (event.defaultPrevented || input.form) return;
  if (matchesShortcut(event.nativeEvent, { key: "Enter" })) {
    event.preventDefault();
    input.blur();
  }
};

function Input({
  className,
  type,
  onPointerDown,
  onKeyDown,
  exitOnCommitKeys = true,
  surface = "raised",
  ref,
  ...props
}: InputProps) {
  const isFileInput = type === "file";
  const handlePointerDown = (event: React.PointerEvent<HTMLInputElement>) => {
    onPointerDown?.(event);
    if (isFileInput) {
      event.stopPropagation();
    }
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (exitOnCommitKeys) exitOnCommitKey(event);
  };

  return (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        "flex h-8 w-full min-w-0 px-2.5 py-2 text-[13px] tracking-[0] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs file:font-medium",
        HIT_TARGET_CLASS,
        surface === "raised" ? controlSurfaceClass : "border-0 bg-transparent shadow-none",
        NESTED_FOCUS_RESET_CLASS,
        DISABLED_CONTROL_CLASS,
        "placeholder:text-(--app-placeholder)",
        "focus-visible:outline-none",
        CONTROL_TRANSITION_TIMING_CLASS,
        isFileInput &&
          "h-9 cursor-pointer py-0 text-[11px] leading-9 file:cursor-pointer file:leading-7 file:mr-2",
        className,
      )}
      {...props}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    />
  );
}

export { Input };

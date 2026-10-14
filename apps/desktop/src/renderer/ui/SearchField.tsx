import * as React from "react";
import { SearchIcon, XIcon } from "lucide-react";

import { cn } from "./cn";
import { InputGroup, InputGroupInput } from "./InputGroup";
import { Button } from "./Button";

type SearchFieldProps = Omit<
  React.ComponentPropsWithRef<typeof InputGroupInput>,
  "type" | "value" | "onChange" | "aria-label" | "className"
> & {
  /** Names the field for assistive technology. */
  label: string;
  /** Names the clear button; "Clear <label>" by default. */
  clearLabel?: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * `raised`: the app's input box. `plain`: no box of its own, for a field the screen around it
   * frames with `className`; its clear button is muted like that chrome.
   */
  surface?: "raised" | "plain";
  /** Shows the magnifier before the text (default true). */
  icon?: boolean;
  /** Classes for the frame around the icon, the text and the clear button. */
  className?: string;
  inputClassName?: string;
};

/** A search box with a clear button. Other props go to the input. */
export function SearchField({
  label,
  clearLabel = `Clear ${label.toLowerCase()}`,
  value,
  onChange,
  surface = "raised",
  icon = true,
  className,
  inputClassName,
  disabled,
  ref,
  ...inputProps
}: SearchFieldProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useImperativeHandle(ref, () => inputRef.current!, []);
  const Frame = surface === "raised" ? InputGroup : "div";

  return (
    <Frame className={cn(surface === "plain" && "flex min-w-0 items-center gap-1.5", className)}>
      {icon ? (
        <SearchIcon aria-hidden="true" className="size-3.5 shrink-0 text-(--app-muted)" />
      ) : null}
      <InputGroupInput
        {...inputProps}
        ref={inputRef}
        type="search"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className={inputClassName}
      />
      {value ? (
        <Button
          size="icon-xs"
          variant={surface === "raised" ? "ghost" : "ghost-muted"}
          aria-label={clearLabel}
          disabled={disabled}
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
        >
          <XIcon aria-hidden="true" />
        </Button>
      ) : null}
    </Frame>
  );
}

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { cn } from "../ui/cn";
import { Input } from "../ui/Input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/Select";

import { PLUGIN_ICONS } from "./pluginIcons";
import type { PluginNode } from "./protocol";

/*
 * The elements a plugin can draw, each mapped onto the app's own components so a plugin looks
 * like the rest of the window in every theme.
 */

const TONE_CLASS: Record<string, string> = {
  default: "text-(--app-text)",
  muted: "text-(--app-muted)",
  accent: "text-(--app-accent)",
  success: "text-(--status-success)",
  warning: "text-(--status-warning)",
  danger: "text-(--status-danger)",
};

const JUSTIFY: Record<string, CSSProperties["justifyContent"]> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
};
const ALIGN: Record<string, CSSProperties["alignItems"]> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
};

type Press = (handler: unknown, payload?: unknown) => void;

function PluginInput({ props, press }: { props: Record<string, unknown>; press: Press }) {
  const value = typeof props.value === "string" ? props.value : "";
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Input
      aria-label={typeof props.label === "string" ? props.label : undefined}
      placeholder={typeof props.placeholder === "string" ? props.placeholder : undefined}
      disabled={props.disabled === true}
      value={draft}
      exitOnCommitKeys={false}
      onChange={(event) => {
        setDraft(event.target.value);
        press(props.onChange, event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && props.onSubmit) {
          event.preventDefault();
          press(props.onSubmit, draft);
        }
      }}
    />
  );
}

const textOf = (children: (PluginNode | string)[]) =>
  children.filter((child): child is string => typeof child === "string").join("");

/** Draws a tree validateTree accepted; `press` sends a handler and its payload to the plugin. */
export function PluginElement({
  node,
  press,
}: {
  node: PluginNode | string;
  press: Press;
}): ReactNode {
  if (typeof node === "string") return node;
  const { type, props, children } = node;
  const kids = children.map((child, index) => (
    <PluginElement key={index} node={child} press={press} />
  ));
  switch (type) {
    case "Box": {
      const step = (value: unknown) => (typeof value === "number" ? value * 4 : undefined);
      return (
        <div
          className={cn(
            "flex min-w-0",
            props.surface === true &&
              "rounded-(--radius-control) border border-(--app-border) bg-(--app-surface)",
          )}
          style={{
            flexDirection: props.direction === "row" ? "row" : "column",
            gap: step(props.gap),
            padding: step(props.padding),
            alignItems: ALIGN[props.align as string],
            justifyContent: JUSTIFY[props.justify as string],
            flexWrap: props.wrap === true ? "wrap" : undefined,
            flexGrow: props.grow === true ? 1 : undefined,
          }}
        >
          {kids}
        </div>
      );
    }
    case "Text":
      return (
        <span
          className={cn(
            TONE_CLASS[(props.tone as string) ?? "default"],
            props.size === "xs" ? "text-[11px]" : props.size === "md" ? "text-sm" : "text-xs",
            props.weight === "semibold"
              ? "font-semibold"
              : props.weight === "medium"
                ? "font-medium"
                : undefined,
            props.mono === true && "font-mono",
            props.truncate === true && "min-w-0 truncate",
          )}
        >
          {textOf(children)}
        </span>
      );
    case "Heading": {
      const Tag = props.level === 1 ? "h2" : props.level === 3 ? "h4" : "h3";
      return (
        <Tag
          className={cn(
            "m-0 font-semibold text-(--app-text)",
            props.level === 1 ? "text-base" : props.level === 3 ? "text-xs" : "text-sm",
          )}
        >
          {textOf(children)}
        </Tag>
      );
    }
    case "Badge":
      return (
        <span
          className={cn(
            "inline-flex items-center rounded-full bg-(--app-surface-2) px-2 py-0.5 text-[11px] font-medium",
            TONE_CLASS[(props.tone as string) ?? "default"],
          )}
        >
          {textOf(children)}
        </span>
      );
    case "Button": {
      const Icon = typeof props.icon === "string" ? PLUGIN_ICONS[props.icon] : undefined;
      const label = textOf(children) || (typeof props.label === "string" ? props.label : "");
      return (
        <Button
          variant={(props.variant as "default") ?? "outline"}
          size={Icon && !textOf(children) ? "icon-sm" : ((props.size as "sm") ?? "sm")}
          disabled={props.disabled === true}
          aria-label={typeof props.label === "string" ? props.label : undefined}
          title={typeof props.label === "string" ? props.label : undefined}
          onClick={() => press(props.onPress)}
        >
          {Icon ? <Icon aria-hidden /> : null}
          {textOf(children) || (Icon ? null : label)}
        </Button>
      );
    }
    case "Input":
      return <PluginInput props={props} press={press} />;
    case "Checkbox":
      return (
        <label className="inline-flex items-center gap-2 text-xs text-(--app-text)">
          <Checkbox
            checked={props.checked === true}
            disabled={props.disabled === true}
            onCheckedChange={(checked) => press(props.onChange, checked === true)}
          />
          {typeof props.label === "string" ? props.label : null}
        </label>
      );
    case "Select": {
      const options = (props.options as { value: string; label: string }[] | undefined) ?? [];
      return (
        <Select
          value={typeof props.value === "string" ? props.value : undefined}
          disabled={props.disabled === true}
          onValueChange={(value) => press(props.onChange, value)}
        >
          <SelectTrigger
            aria-label={typeof props.label === "string" ? props.label : undefined}
            className="min-w-32"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    case "Divider":
      return <hr className="my-1 border-0 border-t border-(--app-border)" />;
    case "Icon": {
      const Icon = PLUGIN_ICONS[props.name as string];
      return Icon ? (
        <Icon aria-hidden className={cn("size-4", TONE_CLASS[(props.tone as string) ?? "muted"])} />
      ) : null;
    }
  }
  return null;
}

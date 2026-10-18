import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { Button, buttonVariants } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { cn } from "../ui/cn";
import { Input } from "../ui/Input";
import { Textarea } from "../ui/Textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/Select";

import {
  CalendarGrid,
  type CalendarGridEvent,
  type CalendarGridView,
} from "./calendar/CalendarGrid";
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

const GRID_HANDLERS = [
  "onCreateRange",
  "onMove",
  "onResize",
  "onSelect",
  "onOpen",
  "onKey",
  "onDismiss",
  "onDayPress",
] as const;
const GRID_DAYS: Record<string, number> = { day: 1, "3day": 3, week: 7, month: 35 };

function PluginInput({ props, press }: { props: Record<string, unknown>; press: Press }) {
  const value = typeof props.value === "string" ? props.value : "";
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (typeof props.rows === "number")
    return (
      <Textarea
        aria-label={typeof props.label === "string" ? props.label : undefined}
        placeholder={typeof props.placeholder === "string" ? props.placeholder : undefined}
        disabled={props.disabled === true}
        autoFocus={props.autoFocus === true}
        rows={props.rows}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          press(props.onChange, event.target.value);
        }}
      />
    );
  return (
    <Input
      autoFocus={props.autoFocus === true}
      type={props.type === "date" || props.type === "time" ? props.type : "text"}
      step={props.type === "time" ? 300 : undefined}
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
          if (props.clearOnSubmit === true) setDraft("");
        }
      }}
    />
  );
}

const NO_EVENTS: CalendarGridEvent[] = [];

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
      const columns = typeof props.columns === "number" ? props.columns : undefined;
      const className = cn(
        columns ? "grid min-w-0" : "flex min-w-0",
        props.surface === true &&
          "rounded-(--radius-control) border border-(--app-border) bg-(--app-surface)",
        props.onPress !== undefined &&
          "cursor-pointer rounded-(--radius-control) text-left transition-colors hover:bg-(--app-control-hover) focus-visible:shadow-[0_0_0_1px_var(--app-focus-ring)] focus-visible:outline-none",
      );
      const style: CSSProperties = {
        ...(columns
          ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
          : {
              flexDirection: props.direction === "row" ? "row" : "column",
              flexWrap: props.wrap === true ? "wrap" : undefined,
            }),
        gap: step(props.gap),
        padding: step(props.padding),
        alignItems: ALIGN[props.align as string],
        justifyContent: JUSTIFY[props.justify as string],
        flexGrow: props.grow === true ? 1 : undefined,
        ...(props.grow === true && { minHeight: 0 }),
        ...(typeof props.width === "number" && { width: props.width, flexShrink: 0 }),
        ...(props.scroll === true && { overflowY: "auto", minHeight: 0 }),
      };
      // A pressable box is one button, so a row of text can be picked as a whole.
      return props.onPress !== undefined ? (
        <button
          type="button"
          className={className}
          style={style}
          aria-label={typeof props.label === "string" ? props.label : undefined}
          onClick={() => press(props.onPress)}
        >
          {kids}
        </button>
      ) : (
        <div className={className} style={style}>
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
            // A long link in plugin text wraps rather than widening its popover.
            props.truncate === true ? "min-w-0 truncate" : "[overflow-wrap:anywhere]",
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
      // A button that opens an address goes out through the window's check, as a link does.
      if (typeof props.href === "string")
        return (
          <a
            href={props.href}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={typeof props.label === "string" ? props.label : undefined}
            title={typeof props.label === "string" ? props.label : undefined}
            className={buttonVariants({
              variant: (props.variant as "default") ?? "outline",
              size: Icon && !textOf(children) ? "icon-sm" : ((props.size as "sm") ?? "sm"),
            })}
          >
            {Icon ? <Icon aria-hidden /> : null}
            {textOf(children) || (Icon ? null : label)}
          </a>
        );
      return (
        <Button
          variant={
            props.selected === true ? "secondary" : ((props.variant as "default") ?? "outline")
          }
          aria-pressed={typeof props.selected === "boolean" ? props.selected : undefined}
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
    case "Link":
      // The window hands new-window links to the system browser, past its safety check.
      return (
        <a
          href={props.href as string}
          target="_blank"
          rel="noreferrer noopener"
          className="min-w-0 truncate text-xs text-(--app-accent) underline-offset-2 hover:underline"
        >
          {textOf(children) || (props.href as string)}
        </a>
      );
    case "Swatch": {
      const color = props.color as string;
      const label = typeof props.label === "string" ? props.label : undefined;
      const className = cn(
        "inline-block size-3.5 shrink-0 rounded-full",
        props.selected === true &&
          "shadow-[0_0_0_2px_var(--app-surface),0_0_0_4px_var(--app-text)]",
      );
      return props.onPress !== undefined ? (
        <button
          type="button"
          aria-label={label}
          aria-pressed={props.selected === true}
          title={label}
          className={cn(
            className,
            "size-5 cursor-pointer border-0 p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-focus-ring)",
          )}
          style={{ background: color }}
          onClick={() => press(props.onPress)}
        />
      ) : (
        <span
          className={className}
          style={{ background: color }}
          role={label ? "img" : undefined}
          aria-label={label}
          aria-hidden={label ? undefined : true}
        />
      );
    }
    case "CalendarGrid": {
      const view = (props.view as CalendarGridView | undefined) ?? "week";
      const handles = new Set<string>(GRID_HANDLERS.filter((name) => props[name] !== undefined));
      return (
        <CalendarGrid
          view={view}
          start={props.start as string}
          days={typeof props.days === "number" ? props.days : GRID_DAYS[view]!}
          events={(props.events as CalendarGridEvent[] | undefined) ?? NO_EVENTS}
          hourHeight={typeof props.hourHeight === "number" ? props.hourHeight : 48}
          snap={typeof props.snapMinutes === "number" ? props.snapMinutes : 15}
          defaultDuration={typeof props.defaultDuration === "number" ? props.defaultDuration : 60}
          workingHours={props.workingHours as { start: number; end: number } | undefined}
          selectedId={typeof props.selectedId === "string" ? props.selectedId : undefined}
          draft={props.draft as Parameters<typeof CalendarGrid>[0]["draft"]}
          label={typeof props.label === "string" ? props.label : undefined}
          popover={kids.length ? kids : null}
          handles={handles}
          emit={(name, payload) => press(props[name], payload)}
        />
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

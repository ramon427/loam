import { useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BrainIcon, ChevronDownIcon, SearchIcon } from "lucide-react";

import {
  AI_EFFORTS,
  type AiChatConfigure,
  type AiChatStatus,
  type AiEffort,
  type AiProviderId,
  type AiProviderStatus,
} from "@loam/shared/ai/aiChat";

import { callBridge } from "../bridge";
import { errorMessage } from "../lib/errorMessage";
import { QUERY_KEYS } from "../settings/queries";
import { cn } from "../ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../ui/DropdownMenu";
import { PopoverContent } from "../ui/Popover";
import { toastError } from "../ui/toast";

import { ModelIcon, ProviderIcon, shortModelName } from "./ModelIcon";

const EFFORT_LABELS: Record<AiEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

/** The composer's own controls: small, label-weight, shaded while open. */
const controlClass =
  "inline-flex h-[30px] min-w-0 shrink items-center gap-1.5 rounded-[9px] px-1.5 text-[12.5px] font-medium text-(--app-secondary-label) outline-none hover:bg-(--app-control-hover) hover:text-(--app-text) focus-visible:ring-2 focus-visible:ring-(--app-focus-ring) disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-(--app-control-hover) data-[state=open]:text-(--app-text)";

/** Changes the side chat's setting and shows it at once, as Settings does. */
function useConfigure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: AiChatConfigure) => callBridge("ai.configure", change),
    onSuccess: (next) => queryClient.setQueryData(QUERY_KEYS.aiChatStatus, next),
    onError: (error) =>
      toastError("The model wasn't changed", { description: errorMessage(error) }),
  });
}

/** The models a provider offers; a CLI without a list offers its own default. */
const modelsOf = (provider: AiProviderStatus, status: AiChatStatus) => {
  const models = [...provider.models];
  if (provider.id === status.provider && status.model && !models.includes(status.model))
    models.unshift(status.model);
  return models.length > 0 ? models : [""];
};

const nameOf = (model: string) => (model ? shortModelName(model) : "Default model");

/**
 * The model the next message goes to, chosen beside it so it stays in view: a rail
 * of the providers that are set up, and their models to search and pick.
 * Picking a model of another provider switches to that provider.
 */
export function AiChatModelPicker({
  status,
  disabled,
}: {
  status: AiChatStatus;
  disabled: boolean;
}) {
  const configure = useConfigure();
  const [open, setOpen] = useState(false);
  const [rail, setRail] = useState<AiProviderId>(status.provider);
  const [query, setQuery] = useState("");
  const providers = status.providers.filter(
    (provider) => provider.ready || provider.id === status.provider,
  );
  const shown = providers.find((provider) => provider.id === rail) ?? providers[0];
  const search = query.trim().toLowerCase();
  const rows = (search ? providers : shown ? [shown] : []).flatMap((provider) =>
    modelsOf(provider, status)
      .filter(
        (model) =>
          !search ||
          model.toLowerCase().includes(search) ||
          nameOf(model).toLowerCase().includes(search),
      )
      .map((model) => ({ provider, model })),
  );
  const choose = (provider: AiProviderId, model: string) => {
    configure.mutate(provider === status.provider ? { model } : { provider, model });
    setOpen(false);
  };
  const label = nameOf(status.model);

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setRail(status.provider);
          setQuery("");
        }
      }}
    >
      <PopoverPrimitive.Trigger
        className={cn(controlClass, "text-(--app-text)")}
        aria-label={`Model: ${label}`}
        disabled={disabled}
      >
        <ModelIcon provider={status.provider} model={status.model} className="size-4" />
        <span className="max-w-28 truncate">{label}</span>
        <ChevronDownIcon
          className="size-3 shrink-0 text-(--app-placeholder)"
          strokeWidth={2.25}
          aria-hidden
        />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverContent
          side="top"
          align="end"
          aria-label="Models"
          className="flex h-[min(21.5rem,var(--radix-popover-content-available-height))] w-[min(22.5rem,calc(100vw-1rem))] overflow-hidden p-0"
        >
          {search ? null : (
            <div
              role="tablist"
              aria-label="Providers"
              className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-(--app-border-subtle) bg-(--app-surface-2)/40 py-2"
            >
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  role="tab"
                  aria-selected={provider.id === shown?.id}
                  aria-label={provider.label}
                  className={cn(
                    "relative grid size-8 place-items-center rounded-md outline-none hover:bg-(--app-text)/10 focus-visible:ring-2 focus-visible:ring-(--app-focus-ring)",
                    provider.id === shown?.id && "bg-(--app-text)/8",
                  )}
                  onClick={() => setRail(provider.id)}
                >
                  <ProviderIcon provider={provider.id} className="size-5" />
                  {provider.id === shown?.id ? (
                    <span className="absolute -right-1.5 h-5 w-0.75 rounded-l-full bg-(--app-accent)" />
                  ) : null}
                </button>
              ))}
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <label className="flex items-center gap-2 border-b border-(--app-border-subtle) px-3 py-2">
              <SearchIcon className="size-3.5 shrink-0 text-(--app-muted)" aria-hidden />
              <input
                autoFocus
                aria-label="Search models"
                placeholder="Search models…"
                className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-(--app-muted)"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  const first = rows[0];
                  if (event.key === "Enter" && first) choose(first.provider.id, first.model);
                }}
              />
            </label>
            <div role="listbox" aria-label="Models" className="min-h-0 flex-1 overflow-y-auto p-1">
              {rows.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-(--app-muted)">No models found</p>
              ) : (
                rows.map(({ provider, model }) => {
                  const selected = provider.id === status.provider && model === status.model;
                  return (
                    <button
                      key={`${provider.id}:${model}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={cn(
                        "flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left outline-none hover:bg-(--app-surface-2) focus-visible:bg-(--app-surface-2)",
                        selected && "bg-(--app-text)/8",
                      )}
                      onClick={() => choose(provider.id, model)}
                    >
                      <span className="flex w-full min-w-0 items-center gap-2 text-xs font-medium text-(--app-text)">
                        <span className="truncate">{nameOf(model)}</span>
                      </span>
                      <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-(--app-muted)">
                        <ModelIcon provider={provider.id} model={model} className="size-3" />
                        <span className="truncate">
                          {provider.label}
                          {model && nameOf(model) !== model ? ` · ${model}` : ""}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </PopoverContent>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/**
 * How hard the model thinks before it answers, as its own control beside the
 * model, so either changes without opening the other. Claude Code keeps its
 * own, so it shows none.
 */
export function AiChatEffortPicker({
  status,
  disabled,
}: {
  status: AiChatStatus;
  disabled: boolean;
}) {
  const configure = useConfigure();
  if (status.provider === "claude-cli") return null;
  const label = status.effort ? EFFORT_LABELS[status.effort] : "Default";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={controlClass}
        aria-label={`Reasoning: ${label}`}
        disabled={disabled}
      >
        <BrainIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
        <ChevronDownIcon
          className="size-3 shrink-0 text-(--app-placeholder)"
          strokeWidth={2.25}
          aria-hidden
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-52">
        <DropdownMenuLabel>Reasoning</DropdownMenuLabel>
        {[null, ...AI_EFFORTS].map((effort) => {
          const selected = effort === status.effort;
          return (
            <DropdownMenuItem
              key={effort ?? "default"}
              role="menuitemradio"
              aria-checked={selected}
              className={cn(selected && "bg-(--app-text)/8")}
              onSelect={() => configure.mutate({ effort })}
            >
              <span className="flex-1">{effort ? EFFORT_LABELS[effort] : "Model's own"}</span>
              {effort === null ? (
                <span className="rounded border border-(--app-border) px-1 text-[10px] text-(--app-muted)">
                  Default
                </span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

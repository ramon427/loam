import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, ChevronDownIcon, Settings2Icon } from "lucide-react";

import {
  AI_EFFORTS,
  type AiChatConfigure,
  type AiChatStatus,
  type AiEffort,
  type AiProviderId,
  type AiProviderStatus,
} from "@loam/shared/ai/aiChat";

import { callBridge } from "../bridge";
import { errorMessage } from "@loam/notes-ui/lib/errorMessage";
import { QUERY_KEYS } from "../settings/queries";
import { cn } from "@loam/notes-ui/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@loam/notes-ui/ui/DropdownMenu";
import { toastError } from "@loam/notes-ui/ui/toast";

import { ModelIcon, shortModelName } from "./ModelIcon";

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

/** The value a submenu holds, shown quietly at the end of its row. */
const subValueClass =
  "ml-auto flex min-w-0 items-center gap-1.5 pl-3 text-[12px] text-(--app-placeholder)";

/**
 * The model the next message goes to and how hard it thinks, in one menu
 * beside it: the models of each provider that is set up, and the effort.
 * Picking a model of another provider switches to that provider.
 */
export function AiChatModelPicker({
  status,
  disabled,
  onManage,
}: {
  status: AiChatStatus;
  disabled: boolean;
  onManage: () => void;
}) {
  const configure = useConfigure();
  const providers = status.providers.filter(
    (provider) => provider.ready || provider.id === status.provider,
  );
  const choose = (provider: AiProviderId, model: string) =>
    configure.mutate(provider === status.provider ? { model } : { provider, model });
  const label = nameOf(status.model);
  const effort = status.effort ? EFFORT_LABELS[status.effort] : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={controlClass}
        aria-label={`Model: ${label}${effort ? `, ${effort}` : ""}`}
        disabled={disabled}
      >
        <ModelIcon provider={status.provider} model={status.model} className="size-4" />
        <span className="max-w-28 truncate text-(--app-text)">{label}</span>
        {effort ? <span className="shrink-0">{effort}</span> : null}
        <ChevronDownIcon
          className="size-3 shrink-0 text-(--app-placeholder)"
          strokeWidth={2.25}
          aria-hidden
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-60">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger aria-label={`Model, ${label}`}>
            <span>Model</span>
            <span className={subValueClass}>
              <ModelIcon provider={status.provider} model={status.model} className="size-3.5" />
              <span className="truncate">{label}</span>
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            {providers.map((provider, index) => (
              <div key={provider.id} role="group" aria-label={provider.label}>
                {index > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuLabel>{provider.label}</DropdownMenuLabel>
                {modelsOf(provider, status).map((model) => {
                  const selected = provider.id === status.provider && model === status.model;
                  return (
                    <DropdownMenuItem
                      key={model}
                      role="menuitemradio"
                      aria-checked={selected}
                      onSelect={() => choose(provider.id, model)}
                    >
                      <ModelIcon provider={provider.id} model={model} className="size-3.5" />
                      <span className="min-w-0 flex-1 truncate">{nameOf(model)}</span>
                      <CheckIcon className={cn("size-3.5", !selected && "invisible")} aria-hidden />
                    </DropdownMenuItem>
                  );
                })}
              </div>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger aria-label={`Effort, ${effort ?? "Default"}`}>
            <span>Effort</span>
            <span className={subValueClass}>{effort ?? "Default"}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            {[null, ...AI_EFFORTS].map((option) => {
              const selected = option === status.effort;
              return (
                <DropdownMenuItem
                  key={option ?? "default"}
                  role="menuitemradio"
                  aria-checked={selected}
                  onSelect={() => configure.mutate({ effort: option })}
                >
                  <span className="flex-1">{option ? EFFORT_LABELS[option] : "Default"}</span>
                  <CheckIcon className={cn("size-3.5", !selected && "invisible")} aria-hidden />
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onManage}>
          <Settings2Icon aria-hidden />
          Manage providers
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

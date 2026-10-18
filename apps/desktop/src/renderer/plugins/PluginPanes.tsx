import { useState } from "react";
import { XIcon } from "lucide-react";

import { useShortcuts, type Shortcut } from "../keyboard/useShortcuts";
import { parsePluginShortcut } from "../keyboard/shortcuts";
import { FormDialog } from "../settings/FormDialog";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

import { pluginHost } from "./host";
import type { PluginPrompt } from "./pluginContributions";
import { PluginSlot, usePluginHost } from "./PluginSlot";

/**
 * The panes plugins opened with `$.ui.open`, docked at the window's right edge. Each draws
 * what its plugin's `ui.render` hook returns for `{ slot: "pane", props: { pane: id } }`.
 */
export function PluginPanes() {
  const { panes } = usePluginHost();
  if (panes.length === 0) return null;
  return (
    <aside
      aria-label="Plugin panes"
      // Over the note, below the window's top row, so the window buttons stay clear.
      className="absolute top-(--loam-titlebar-height) right-0 bottom-0 z-20 flex w-80 flex-col gap-2 overflow-y-auto border-l border-(--app-divider) bg-(--app-bg) p-2 shadow-(--app-shadow-elevated)"
    >
      {panes.map((pane) => (
        <section
          key={`${pane.pluginId}:${pane.id}`}
          aria-label={pane.title}
          data-plugin-pane={`${pane.pluginId}:${pane.id}`}
          className="flex flex-col gap-2 rounded-(--radius-control) border border-(--app-border) bg-(--app-surface) p-3"
        >
          <header className="flex items-center justify-between gap-2">
            <h2 className="m-0 truncate text-xs font-semibold text-(--app-text)">{pane.title}</h2>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Close ${pane.title}`}
              onClick={() => pluginHost.closePane(pane.pluginId, pane.id)}
            >
              <XIcon aria-hidden />
            </Button>
          </header>
          <PluginSlot
            name="pane"
            only={pane.pluginId}
            props={{ pane: pane.id }}
            className="flex-col items-stretch"
          />
        </section>
      ))}
    </aside>
  );
}

/** Runs plugin commands from the shortcuts they asked for. */
export function PluginShortcuts({ enabled }: { enabled: boolean }) {
  const { commands } = usePluginHost();
  useShortcuts(
    commands.flatMap((command): Shortcut[] => {
      const combo = command.key ? parsePluginShortcut(command.key) : null;
      return combo
        ? [
            {
              id: command.id as `plugin:${string}`,
              combo,
              enabled,
              allowInEditable: true,
              run: () => void pluginHost.runCommand(command.id),
            },
          ]
        : [];
    }),
  );
  return null;
}

function PromptDialog({ prompt }: { prompt: PluginPrompt }) {
  const [value, setValue] = useState(prompt.value ?? "");
  return (
    <FormDialog
      title={prompt.title}
      description={pluginHost.pluginName(prompt.pluginId)}
      onClose={() => prompt.answer(null)}
      onSubmit={() => prompt.answer(value)}
      footer={
        <>
          <Button type="button" variant="outline" size="sm" onClick={() => prompt.answer(null)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!value.trim()}>
            OK
          </Button>
        </>
      }
    >
      <Input
        autoFocus
        aria-label={prompt.title}
        placeholder={prompt.placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </FormDialog>
  );
}

/** The line of text a plugin asked for with `$.ui.prompt`, one question at a time. */
export function PluginPromptDialog() {
  const { prompt } = usePluginHost();
  return prompt ? <PromptDialog key={prompt.id} prompt={prompt} /> : null;
}

import { useEffect, useRef, useState } from "react";
import { XIcon } from "lucide-react";

import { useShortcuts, type Shortcut } from "@loam/notes-ui/keyboard/useShortcuts";
import { parsePluginShortcut } from "@loam/notes-ui/keyboard/shortcuts";
import { NoteHeader } from "@loam/notes-ui/note/NoteHeader";
import { FormDialog } from "../settings/FormDialog";
import { MainHeader } from "../shell/WindowChrome";
import { Button } from "@loam/notes-ui/ui/Button";
import { Input } from "@loam/notes-ui/ui/Input";
import { useNotesWorkspace } from "@loam/notes-ui/workspace/NotesWorkspace";

import { pluginHost } from "./host";
import type { PluginPane, PluginPrompt } from "./pluginContributions";
import { PluginSlot, usePluginHost } from "./PluginSlot";

/**
 * The panes plugins opened with `$.ui.open`, docked at the window's right edge. Each draws
 * what its plugin's `ui.render` hook returns for `{ slot: "pane", props: { pane: id } }`.
 */
export function PluginPanes() {
  const panes = usePluginHost().panes.filter((pane) => pane.place === "side");
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

function ViewSurface({ view }: { view: PluginPane }) {
  const ref = useRef<HTMLElement>(null);
  // The view takes the keyboard as it opens, so its own keys (such as a calendar's) work.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [view.pluginId, view.id]);
  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-label={view.title}
      data-plugin-view={`${view.pluginId}:${view.id}`}
      className="absolute inset-0 z-10 flex flex-col bg-(--app-page) font-(--font-body) text-(--app-text) outline-none"
    >
      <MainHeader>
        <NoteHeader
          title={<h1 className="truncate px-[13px] text-base font-medium">{view.title}</h1>}
          actions={
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Close ${view.title}`}
              onClick={() => pluginHost.closePane(view.pluginId, view.id)}
            >
              <XIcon aria-hidden />
              Close
            </Button>
          }
        />
      </MainHeader>
      <PluginSlot
        name="view"
        only={view.pluginId}
        props={{ view: view.id }}
        className="min-h-0 flex-1 flex-col items-stretch gap-0"
      />
    </section>
  );
}

/**
 * The view a plugin opened over the notes with `$.ui.open({ place: "main" })`, as a file
 * opened from outside shows. Opening a note closes it, so the notes are one click away.
 */
export function PluginView() {
  const view = usePluginHost().panes.find((pane) => pane.place === "main");
  const { activeNoteId } = useNotesWorkspace();
  const shownFor = useRef(activeNoteId);
  useEffect(() => {
    if (activeNoteId !== shownFor.current) {
      shownFor.current = activeNoteId;
      pluginHost.closeViews();
    }
  }, [activeNoteId]);
  return view ? <ViewSurface key={`${view.pluginId}:${view.id}`} view={view} /> : null;
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
  const description = prompt.description ?? pluginHost.pluginName(prompt.pluginId);
  if (prompt.choices) {
    const [first, ...rest] = prompt.choices;
    return (
      <FormDialog
        title={prompt.title}
        description={description}
        onClose={() => prompt.answer(null)}
        onSubmit={() => prompt.answer(first!.value)}
        footer={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => prompt.answer(null)}>
              Cancel
            </Button>
            {[...rest].reverse().map((choice) => (
              <Button
                key={choice.value}
                type="button"
                variant={choice.tone === "danger" ? "destructive" : "outline"}
                size="sm"
                onClick={() => prompt.answer(choice.value)}
              >
                {choice.label}
              </Button>
            ))}
            <Button
              type="submit"
              size="sm"
              variant={first!.tone === "danger" ? "destructive" : "default"}
              autoFocus
            >
              {first!.label}
            </Button>
          </>
        }
      >
        {null}
      </FormDialog>
    );
  }
  return (
    <FormDialog
      title={prompt.title}
      description={description}
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

/** The question a plugin asked with `$.ui.prompt` or `$.ui.choose`, one at a time. */
export function PluginPromptDialog() {
  const { prompt } = usePluginHost();
  return prompt ? <PromptDialog key={prompt.id} prompt={prompt} /> : null;
}

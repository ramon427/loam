import { useMemo } from "react";
import { PuzzleIcon } from "lucide-react";

import type {
  NotesExtensionCommand,
  NotesExtensions,
} from "@loam/notes-ui/extensions/NotesExtensions";
import { formatCombo, parsePluginShortcut } from "@loam/notes-ui/keyboard/shortcuts";
import type { NoteBlockEditor } from "@loam/notes-ui/editor/noteEditorSchema";
import type { SlashCommand } from "@loam/notes-ui/editor/slashMenuModel";

import { MainHeader } from "../shell/WindowChrome";

import { pluginHost } from "./host";
import { runPluginSlashItem } from "./insertPluginMarkdown";
import { PluginSlot, usePluginHost } from "./PluginSlot";

const usePluginSlashItems = ({ editor, noteId }: { editor: NoteBlockEditor; noteId: string }) => {
  const { slashItems } = usePluginHost();
  return useMemo(
    () =>
      slashItems.map((item): SlashCommand => ({
        key: `plugin:${item.pluginId}.${item.id}`,
        title: item.title,
        subtext: item.subtext,
        aliases: item.aliases,
        group: "Plugins",
        icon: <PuzzleIcon className="size-4" aria-hidden />,
        onItemClick: () => void runPluginSlashItem(editor, item, noteId),
      })),
    [editor, noteId, slashItems],
  );
};

const usePluginCommands = () => {
  const { commands } = usePluginHost();
  return useMemo(
    () =>
      commands.map((command): NotesExtensionCommand => {
        const combo = command.key ? parsePluginShortcut(command.key) : null;
        return {
          id: command.id,
          title: command.title,
          detail: pluginHost.pluginName(command.pluginId),
          ...(combo && { shortcut: formatCombo(combo) }),
          run: () => void pluginHost.runCommand(command.id),
        };
      }),
    [commands],
  );
};

const beforeOpenNote = (noteId: string) => {
  // Only a plugin hooking note.open costs the open a round trip to its worker.
  if (!pluginHost.hooks("note.open")) return null;
  return pluginHost
    .dispatch("note.open", { noteId }, () => ({}))
    .then((result) => {
      const deny = (result as { deny?: unknown } | null)?.deny;
      return typeof deny === "string" ? deny : undefined;
    });
};

/** What Loam's plugins add to the notes screens, and the window's own header row. */
export const pluginNotesExtensions: NotesExtensions = {
  Slot: PluginSlot,
  useSlashItems: usePluginSlashItems,
  useCommands: usePluginCommands,
  beforeOpenNote,
  MainHeader,
};

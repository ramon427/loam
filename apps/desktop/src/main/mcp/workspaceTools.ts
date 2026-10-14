import { z } from "zod";

import { StoreError } from "@loam/storage/storeError";

import { idSchema, uuidSchema } from "../requests/params";
import type { ToolContext, ToolDefinition } from "./tools";

/** Tools the window carries out: what it shows, opening a note, its theme and the video player. */
export const workspaceTools = ({
  app,
  define,
  fullNote,
  withNotes,
}: ToolContext): ToolDefinition[] => [
  define(
    "loam_workspace_status",
    "Read which note and tab the window shows, and its theme.",
    {},
    () => app.workspace.request({ action: "status" }),
    { readOnly: true },
  ),
  define(
    "loam_workspace_open",
    "Open a note and optionally select one of its tabs. null opens the library. Pending edits are saved before navigation.",
    { noteId: uuidSchema.nullable(), tabId: idSchema.optional() },
    async (input) => {
      if (input.noteId !== null) {
        const note = await fullNote(input.noteId);
        if (input.tabId && !note.tabs.some((tab) => tab.id === input.tabId))
          throw new StoreError("Tab not found.", "NOT_FOUND", 404);
      }
      // The window selects the tab, and saves the choice like a click would.
      return app.workspace.request({ action: "openNote", ...input });
    },
    withNotes,
  ),
  define(
    "loam_workspace_set_theme",
    "Change and persist the app's appearance: light, dark or system mode, and/or a colour theme by id (loam, nord, solarized, catppuccin, rose-pine, paper, or a theme file in the library's themes folder).",
    {
      theme: z.enum(["light", "dark", "system"]).optional(),
      themeId: z.string().max(64).optional(),
    },
    (input) => app.workspace.request({ action: "setTheme", ...input }),
  ),
  define(
    "loam_workspace_video",
    "Open the note's video panel or send play, pause or seek to its player. Playback depends on YouTube availability; this reports the command sent.",
    {
      command: z.enum(["open", "play", "pause", "seek"]),
      seconds: z.number().finite().nonnegative().optional(),
    },
    (input) => app.workspace.request({ action: "video", ...input }),
  ),
];

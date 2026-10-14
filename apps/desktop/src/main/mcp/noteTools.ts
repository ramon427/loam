import { randomUUID } from "node:crypto";

import { z } from "zod";

import { noteVideoSchema } from "@loam/shared/notes/noteVideoSchema";
import { StoreError } from "@loam/storage/storeError";

import { uuidSchema } from "../requests/params";
import { blocksSchema } from "./schemas";
import type { ToolContext, ToolDefinition } from "./tools";

/** Tools that make a note, read its images and set its video. */
export const noteTools = ({
  app,
  call,
  define,
  noteId,
  baseUpdatedAt,
  withNotes,
}: ToolContext): ToolDefinition[] => [
  define(
    "loam_media_read_image",
    "Read an existing local note image by its loam-media URL or generated file name, including when the unlocked library is encrypted.",
    { reference: z.string().min(1).max(512) },
    ({ reference }) => app.gate.library().media.readImage(reference),
    { readOnly: true },
    () => true,
  ),
  define(
    "loam_notes_new",
    "Create a text note with generated IDs, optionally from Markdown or native blocks. A folder decides the note's project; projectId places it outside folders in a project.",
    {
      title: z.string(),
      folderId: uuidSchema.nullable().optional(),
      projectId: uuidSchema.nullable().optional(),
      markdown: z.string().optional(),
      blocks: blocksSchema.optional(),
    },
    async ({ title, folderId, projectId, markdown, blocks }) => {
      if (markdown !== undefined && blocks !== undefined)
        throw new StoreError("Use Markdown or blocks, not both.", "VALIDATION_ERROR", 400);
      const tabId = randomUUID();
      const body =
        markdown === undefined
          ? (blocks ?? [])
          : ((await app.workspace.request({
              action: "parseMarkdown",
              text: markdown,
            })) as unknown[]);
      return call("notes.create", {
        note: {
          id: randomUUID(),
          title,
          folderId,
          projectId,
          tabs: [{ id: tabId, title: "Notes", kind: "page" }],
          activeTabId: tabId,
          blocksByTab: { [tabId]: body },
        },
      });
    },
    withNotes,
  ),
  define(
    "loam_video_set",
    "Attach or remove a note's study video and saved playback position. Timestamp links in blocks and diagram nodes are editable through their schemas.",
    { ...noteId, video: noteVideoSchema.nullable(), baseUpdatedAt },
    (input) =>
      call("notes.save", {
        noteId: input.noteId,
        baseUpdatedAt: input.baseUpdatedAt,
        patch: { video: input.video },
      }),
    withNotes,
  ),
];

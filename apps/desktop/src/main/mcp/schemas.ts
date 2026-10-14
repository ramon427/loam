import { isAbsolute } from "node:path";

import { z } from "zod";

import { noteGraphNodeColors } from "@loam/shared/notes/noteGraphColors";
import { noteGraphSchema } from "@loam/shared/notes/noteGraphSchema";
import { NOTE_TAB_KINDS } from "@loam/shared/notes/noteModel";
import {
  MAX_PROJECT_NAME_LENGTH,
  NOTE_PROJECT_SYMBOLS,
  readNoteProjectIcon,
} from "@loam/shared/notes/noteProjects";
import { noteTableSchema } from "@loam/shared/notes/noteTableSchema";
import { noteVideoSchema } from "@loam/shared/notes/noteVideoSchema";

import { idSchema, uuidSchema } from "../requests/params";

/**
 * What AI clients may send. These are stricter than what the window may
 * save, and are published to clients as each tool's JSON schema.
 */

export const pathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((path) => !path.includes("\0") && isAbsolute(path), "An absolute local path is required.")
  .describe("Absolute path on the computer running Loam.");
export const blocksSchema = z
  .array(z.record(z.string(), z.unknown()))
  .describe(
    "BlockNote block JSON, including headings, lists, checklists, code, tables, images, columns, formatted inline content and links. Preserve block IDs when editing. Note links use /notes?noteId=<id>; video timestamp links use #note-video?t=<seconds>.",
  );
const tabSchema = z.object({
  id: idSchema,
  title: z.string(),
  kind: z.enum(NOTE_TAB_KINDS).optional(),
  position: z.number().int().nonnegative().optional(),
});
const noteContentSchema = z.object({
  title: z.string(),
  tabs: z.array(tabSchema).min(1),
  blocksByTab: z.record(z.string(), blocksSchema),
  activeTabId: idSchema,
  graphsByTab: z.record(z.string(), noteGraphSchema).optional(),
  tablesByTab: z.record(z.string(), noteTableSchema).optional(),
  textsByTab: z
    .record(z.string(), z.string())
    .optional()
    .describe("Markdown of Text tabs from older versions, which open as diagrams holding it."),
  embedsByTab: z.record(z.string(), z.object({ url: z.string() })).optional(),
  filesByTab: z
    .record(
      z.string(),
      z.object({
        name: z.string(),
        source: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("imported"), fileName: z.string() }),
          z.object({ kind: z.literal("text"), text: z.string() }),
          z.object({ kind: z.literal("referenced"), path: z.string(), computerId: z.string() }),
        ]),
        page: z.number().int().positive().optional(),
      }),
    )
    .optional()
    .describe(
      "The files of PDF, Word and Markdown tabs. A Markdown file the note holds is its source's text, which can be edited; keep other sources as read, since they name files the app stored or that are on this computer.",
    ),
  video: noteVideoSchema.optional(),
  graph: noteGraphSchema.optional(),
});
export const notePatchSchema = noteContentSchema
  .partial()
  .extend({
    video: noteVideoSchema.nullable().optional(),
    graph: noteGraphSchema.nullable().optional(),
  })
  .strict();
const notePlaceProjectSchema = uuidSchema
  .nullable()
  .optional()
  .describe(
    "Used when folderId is null: the project whose top level holds the note, or null for the library's top level. A folder decides its notes' project.",
  );
export const newNoteSchema = noteContentSchema.extend({
  id: uuidSchema,
  folderId: uuidSchema.nullable().optional(),
  projectId: notePlaceProjectSchema,
});
export const noteDocumentSchema = noteContentSchema.extend({
  id: uuidSchema,
  updatedAt: z.string(),
  folderId: uuidSchema.optional(),
  projectId: uuidSchema.optional(),
  position: z.number().optional(),
  contentState: z.literal("full").optional(),
});
export const projectNameSchema = z.string().min(1).max(MAX_PROJECT_NAME_LENGTH);
export const projectIconSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("emoji"),
      value: z
        .string()
        .refine((value) => readNoteProjectIcon({ kind: "emoji", value }), "Use a single emoji."),
    }),
    z.object({
      kind: z.literal("symbol"),
      value: z.enum(NOTE_PROJECT_SYMBOLS),
      color: z.enum(noteGraphNodeColors).optional(),
    }),
  ])
  .describe("A single emoji, or one of the app's line icons in an optional palette color.");
export const layoutSchema = z.object({
  projects: z
    .array(z.object({ id: uuidSchema, name: z.string(), icon: projectIconSchema.optional() }))
    .optional()
    .describe("Every project in order. Omit to keep the stored projects."),
  folders: z.array(
    z.object({
      id: uuidSchema,
      name: z.string(),
      projectId: uuidSchema
        .nullable()
        .optional()
        .describe("The folder's project, or null for the top level. Omit to keep its project."),
    }),
  ),
  notes: z.array(
    z.object({
      id: uuidSchema,
      folderId: uuidSchema.nullable(),
      projectId: notePlaceProjectSchema,
    }),
  ),
});

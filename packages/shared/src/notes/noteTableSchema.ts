import { z } from "zod";

import {
  NOTE_TABLE_COLUMN_TYPES,
  type NoteTable,
  type NoteTableColumn,
  type NoteTableRow,
} from "./noteModel";

/** A schema field for every field of `T`, so a field added to the model fails to compile here. */
type FieldsOf<T> = { [K in keyof T]-?: z.ZodType };

const itemIdSchema = z.string().min(1).max(512);
const positionSchema = z.number().int().nonnegative();

const noteTableColumnSchema = z.object({
  id: itemIdSchema,
  title: z.string(),
  type: z.enum(NOTE_TABLE_COLUMN_TYPES),
  headingBlockIds: z.array(itemIdSchema).optional(),
  width: z.number().positive().optional(),
  position: positionSchema.optional(),
  options: z.array(z.object({ id: itemIdSchema, label: z.string() })).optional(),
} satisfies FieldsOf<NoteTableColumn>) satisfies z.ZodType<NoteTableColumn>;

const noteTableRowSchema = z.object({
  id: itemIdSchema,
  headingBlockIds: z.array(itemIdSchema).optional(),
  position: positionSchema.optional(),
  cells: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.null()])),
} satisfies FieldsOf<NoteTableRow>) satisfies z.ZodType<NoteTableRow>;

/** A table as AI clients must send it. */
export const noteTableSchema = z.object({
  columns: z.array(noteTableColumnSchema),
  rows: z.array(noteTableRowSchema),
  groupColumnId: z.string().optional(),
} satisfies FieldsOf<NoteTable>) satisfies z.ZodType<NoteTable>;

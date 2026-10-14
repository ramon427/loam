import { z } from "zod";

import type { NoteVideo } from "./noteModel";

/** A note's study video as AI clients must send it. */
export const noteVideoSchema = z.object({
  url: z.string(),
  videoId: z.string(),
  title: z.string().optional(),
  lastWatchedSeconds: z.number().finite().nonnegative().optional(),
} satisfies { [K in keyof NoteVideo]-?: z.ZodType }) satisfies z.ZodType<NoteVideo>;

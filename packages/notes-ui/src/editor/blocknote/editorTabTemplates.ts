import type { NotePartialBlock } from "../noteEditorSchema";

import { createUuid } from "@loam/shared/utils/uuid";

// Assign identity once, before editor and persistence normalize the same body.
export const createDefaultBlocks = (): NotePartialBlock[] => [
  { id: createUuid(), type: "paragraph" },
];

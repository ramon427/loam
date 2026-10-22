import type {
  Block,
  BlockNoteEditor,
  BlockNoteEditorOptions,
  BlocksChanged,
  PartialBlock,
} from "@blocknote/core";
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";

import { columnBlockSpecs } from "@loam/shared/notes/columnBlocks";

import { graphSnapshotBlockSpec } from "../graph/NoteGraphSnapshotBlock";

/** BlockNote's default blocks plus columns and graph snapshots. */
export const noteEditorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    ...columnBlockSpecs,
    graphSnapshot: graphSnapshotBlockSpec(),
  },
});

type Schema = typeof noteEditorSchema;

export type NoteBlockEditor = BlockNoteEditor<
  Schema["blockSchema"],
  Schema["inlineContentSchema"],
  Schema["styleSchema"]
>;
/** Options of the note editor, for typing its callbacks (paste, link clicks). */
export type NoteEditorOptions = BlockNoteEditorOptions<
  Schema["blockSchema"],
  Schema["inlineContentSchema"],
  Schema["styleSchema"]
>;
/** What an edit to the note editor changes, block by block. */
export type NoteBlockChanges = BlocksChanged<
  Schema["blockSchema"],
  Schema["inlineContentSchema"],
  Schema["styleSchema"]
>;
export type NoteBlock = Block<
  Schema["blockSchema"],
  Schema["inlineContentSchema"],
  Schema["styleSchema"]
>;
/**
 * The editor's contenteditable, or null while BlockNote hasn't mounted it: a
 * note opened on a graph or table tab never renders the editor, and until it
 * does, reading `domElement` throws.
 */
export const mountedEditorDom = (editor: { readonly domElement: HTMLElement | undefined }) => {
  try {
    return editor.domElement ?? null;
  } catch {
    return null;
  }
};

/** The plain text of a block's inline content, links included. */
export const inlineText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item: unknown) => {
      if (typeof item === "string") return item;
      if (typeof item !== "object" || item === null) return "";
      if ("text" in item && typeof item.text === "string") return item.text;
      return "content" in item ? inlineText(item.content) : "";
    })
    .join("");
};

/**
 * Removes an image block that never got an image, as after a failed upload
 * or a rejected file; BlockNote would leave it behind empty.
 */
export const removeEmptyImageBlock = (editor: NoteBlockEditor, blockId: string) => {
  const block = editor.getBlock(blockId);
  if (block?.type === "image" && !block.props.url) editor.removeBlocks([block]);
};

export type NotePartialBlock = PartialBlock<
  Schema["blockSchema"],
  Schema["inlineContentSchema"],
  Schema["styleSchema"]
>;

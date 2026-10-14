import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";

import type { BridgeImportFile, BridgeImportNote } from "@loam/shared/bridge/loamBridge";
import { columnBlockSpecs } from "@loam/shared/notes/columnBlocks";
import { isEditorLink } from "@loam/shared/notes/noteLinks";

/** A 1×1 transparent PNG. */
export const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** An editor with the same schema the app's editor uses. Needs the jsdom environment. */
export const createEditor = () =>
  BlockNoteEditor.create({
    schema: BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, ...columnBlockSpecs } }),
    links: { isValidLink: isEditorLink },
  });

/** Hands out note ids in order, so a test's ids are predictable. */
export const createIdCounter = () => {
  let counter = 0;
  return () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
};

export const importFile = (path: string, text: string): BridgeImportFile => ({ path, text });

type ImportedBlock = {
  type: string;
  props: Record<string, unknown>;
  content?: Array<{
    type: string;
    text?: string;
    href?: string;
    content?: Array<{ text: string }>;
  }>;
};

export const byTitle = (notes: BridgeImportNote[], title: string) => {
  const note = notes.find((candidate) => candidate.title === title);
  if (!note) throw new Error(`No note titled ${title}`);
  return note;
};

export const blocksOf = (note: BridgeImportNote) =>
  note.blocksByTab[note.activeTabId] as ImportedBlock[];

const inlineOf = (block: ImportedBlock) => (Array.isArray(block.content) ? block.content : []);

export const textOf = (block: ImportedBlock) =>
  inlineOf(block)
    .map((item) => item.text ?? item.content?.map((run) => run.text).join("") ?? "")
    .join("");

/** Each link in a note as `[label, href]`. */
export const linksOf = (note: BridgeImportNote) =>
  blocksOf(note).flatMap((block) =>
    inlineOf(block)
      .filter((item) => item.type === "link")
      .map((item) => [item.content?.map((run) => run.text).join(""), item.href]),
  );

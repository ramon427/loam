import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";

import { columnBlockSpecs } from "@loam/shared/notes/columnBlocks";
import { isEditorLink } from "@loam/shared/notes/noteLinks";

type Parsers = {
  markdown: (markdown: string) => unknown[];
  html: (html: string) => unknown[];
};

let parsers: Parsers | null = null;

/** A detached editor with the app's schema, so parsed blocks match what the editor makes. */
const getParsers = () => {
  if (!parsers) {
    const editor = BlockNoteEditor.create({
      schema: BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, ...columnBlockSpecs } }),
      links: { isValidLink: isEditorLink },
    });
    parsers = {
      markdown: (markdown) => editor.tryParseMarkdownToBlocks(markdown),
      html: (html) => editor.tryParseHTMLToBlocks(html),
    };
  }
  return parsers;
};

export const parseMarkdown = (markdown: string) => getParsers().markdown(markdown);
export const parseHtml = (html: string) => getParsers().html(html);

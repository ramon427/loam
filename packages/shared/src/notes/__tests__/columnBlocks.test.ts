// @vitest-environment jsdom

import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { describe, expect, it } from "vitest";

import { columnBlockSpecs } from "../columnBlocks";

const paragraph = (id: string, text: string) => ({
  id,
  type: "paragraph",
  props: { backgroundColor: "default", textColor: "default", textAlignment: "left" },
  content: [{ type: "text", text, styles: {} }],
  children: [],
});

const column = () => ({ type: "column", children: [{ type: "paragraph" }] });

/** Blocks as notes have stored column layouts, one column resized. */
const storedBlocks = [
  paragraph("p-before", "Before"),
  {
    id: "list",
    type: "columnList",
    props: {},
    children: [
      { id: "col-left", type: "column", props: { width: 1.5 }, children: [paragraph("p-l", "L")] },
      { id: "col-right", type: "column", props: { width: 1 }, children: [paragraph("p-r", "R")] },
    ],
  },
];

/** The HTML the layout has always rendered as, which styles and pasted layouts rely on. */
const listHtml =
  '<div class="bn-block-column-list" data-node-type="columnList" data-id="list" style="display: flex;">' +
  '<div class="bn-block-column" data-node-type="column" data-id="col-left" data-width="1.5" style="flex-grow: 1.5;">';

const createEditor = () =>
  BlockNoteEditor.create({
    schema: BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, ...columnBlockSpecs } }),
    initialContent: storedBlocks as never,
  });

describe("column blocks", () => {
  it("open stored layouts and give back the same JSON", () => {
    const editor = createEditor();
    expect(JSON.parse(JSON.stringify(editor.document))).toEqual(storedBlocks);
  });

  it("render the HTML BlockNote's columns render, and read it back", () => {
    const editor = createEditor();
    const html = editor.blocksToFullHTML(editor.document);
    expect(html).toContain(listHtml);
    expect(JSON.parse(JSON.stringify(editor.tryParseHTMLToBlocks(html)))).toEqual(storedBlocks);
  });

  it("give new columns a width of 1", () => {
    const editor = createEditor();
    const [inserted] = editor.insertBlocks(
      [{ type: "columnList", children: [column(), column()] } as never],
      "p-before",
      "after",
    );
    const widths = (inserted?.children ?? []).map((column) => column.props);
    expect(widths).toEqual([{ width: 1 }, { width: 1 }]);
  });
});

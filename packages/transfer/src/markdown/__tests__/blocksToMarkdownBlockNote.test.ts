// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { createEditor } from "../../__tests__/testKit";
import { renderBlocks, type BlocksToMarkdownContext } from "../blocksToMarkdown";

// The app's editor schema, so these are the shapes notes really store.
const editor = createEditor();

const context: BlocksToMarkdownContext = {
  noteTarget: () => null,
  videoUrlAt: () => null,
  imagePath: () => null,
};

const roundTrip = async (markdown: string) =>
  renderBlocks(await editor.tryParseMarkdownToBlocks(markdown), context);

describe("renderBlocks with BlockNote's own block JSON", () => {
  it("round-trips common Markdown unchanged", async () => {
    const markdown = [
      "# Heading",
      "Some **bold**, *italic*, ~~struck~~ and `code` text with a [link](https://example.com).",
      "- one\n  - nested\n- two",
      "1. first\n2. second",
      "- [ ] open\n- [x] done",
      "> quoted",
      "```js\nconst x = 1;\n```",
      "| A | B |\n| --- | --- |\n| 1 | 2 |",
      "---",
      "![alt](https://example.com/image.png)",
    ].join("\n\n");

    expect(await roundTrip(markdown)).toBe(markdown);
  });
});

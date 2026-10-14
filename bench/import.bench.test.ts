// @vitest-environment jsdom

import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { it } from "vitest";

import type { BridgeImportFile } from "@loam/shared/bridge/loamBridge";
import { columnBlockSpecs } from "@loam/shared/notes/columnBlocks";
import { convertMarkdownImport } from "@loam/transfer/import/markdownImport";

import { formatMs, report, timeOnce } from "./benchTimer";
import { BENCH_NOTE_COUNT, createRandom } from "./libraryFixture";

const WORDS = "market price trend review lesson setup entry exit risk study video chapter".split(
  " ",
);

/** A vault like a long-used Obsidian one: headings, lists, links and embeds. */
const buildVault = (): BridgeImportFile[] => {
  const random = createRandom(3);
  const words = (count: number) =>
    Array.from({ length: count }, () => random.pick(WORDS)).join(" ");
  return Array.from({ length: BENCH_NOTE_COUNT }, (_, index) => {
    const lines = [`# ${words(3)}`];
    for (let paragraph = random.int(5, 20); paragraph > 0; paragraph -= 1) {
      lines.push(
        "",
        paragraph % 4 === 0 ? `- ${words(8)}\n- ${words(6)}` : words(random.int(20, 70)),
      );
    }
    lines.push(
      "",
      `Related: [[Note ${random.int(0, BENCH_NOTE_COUNT - 1)}]] and [[Note ${random.int(0, BENCH_NOTE_COUNT - 1)}|alias]]`,
    );
    if (index % 10 === 0) lines.push("", "![[chart.png]]");
    return {
      path: `Folder ${index % 50}/Note ${index}.md`,
      text: lines.join("\n"),
      modifiedAt: 0,
    };
  });
};

it(
  "times converting a 10,000-file Markdown vault",
  async () => {
    const editor = BlockNoteEditor.create({
      schema: BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, ...columnBlockSpecs } }),
    });
    const files = buildVault();
    let counter = 0;
    const converted = await timeOnce(() =>
      convertMarkdownImport({
        files,
        createId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
        parseMarkdown: (markdown) => editor.tryParseMarkdownToBlocks(markdown),
        saveImages: async (requests) =>
          requests.map(() => ({ url: "loam-media://images/chart.png" })),
      }),
    );
    report("Import conversion benchmark", [
      {
        step: `Convert ${files.length.toLocaleString("en")} Markdown files`,
        result: `${formatMs(converted.ms)} (${(converted.ms / files.length).toFixed(2)} ms per file, ${converted.value.notes.length} notes)`,
      },
    ]);
  },
  30 * 60 * 1000,
);

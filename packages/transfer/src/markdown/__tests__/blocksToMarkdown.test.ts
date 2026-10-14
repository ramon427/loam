import { describe, expect, it } from "vitest";

import { renderBlocks, type BlocksToMarkdownContext } from "../blocksToMarkdown";
import { escapeLineStart, escapeMarkdownText, renderInlineContent } from "../inlineMarkdown";

const LINKED_ID = "00000000-0000-4000-8000-000000000001";
const MISSING_ID = "00000000-0000-4000-8000-000000000009";

const context: BlocksToMarkdownContext = {
  noteTarget: (noteId) =>
    noteId === LINKED_ID ? { target: "Project plan", title: "Project plan" } : null,
  videoUrlAt: (seconds) => `https://www.youtube.com/watch?v=abc123&t=${seconds}s`,
  imagePath: (reference) => (/^[\w-]+\.png$/.test(reference) ? `attachments/${reference}` : null),
};

const text = (value: string, styles: Record<string, boolean> = {}) => ({
  type: "text",
  text: value,
  styles,
});
const link = (href: string, label: string) => ({ type: "link", href, content: [text(label)] });
const block = (
  type: string,
  content: unknown = [],
  props: Record<string, unknown> = {},
  children: unknown[] = [],
) => ({ id: crypto.randomUUID(), type, props, content, children });

it("keeps live graph snapshot references visible in Markdown exports", () => {
  expect(
    renderBlocks(
      [
        block("graphSnapshot", null, {
          noteId: LINKED_ID,
          tabId: "graph",
          x: 0,
          y: 0,
          width: 400,
          height: 200,
        }),
      ],
      context,
    ),
  ).toBe("> Live graph snapshot of [[Project plan]].");
});

describe("escapeMarkdownText", () => {
  it("escapes syntax characters but keeps snake_case readable", () => {
    expect(escapeMarkdownText("a *b* [c] `d` <e> \\ f")).toBe(
      "a \\*b\\* \\[c\\] \\`d\\` \\<e> \\\\ f",
    );
    expect(escapeMarkdownText("snake_case _lead trail_")).toBe("snake_case \\_lead trail\\_");
    expect(escapeMarkdownText("~~gone~~ but ~one")).toBe("\\~\\~gone\\~\\~ but ~one");
    expect(escapeMarkdownText("a|b")).toBe("a|b");
    expect(escapeMarkdownText("a|b", { inTable: true })).toBe("a\\|b");
  });

  it("stops line starts from becoming headings, quotes, lists or rules", () => {
    expect(escapeLineStart("# not a heading")).toBe("\\# not a heading");
    expect(escapeLineStart("> not a quote")).toBe("\\> not a quote");
    expect(escapeLineStart("- not a list")).toBe("\\- not a list");
    expect(escapeLineStart("2. not numbered")).toBe("2\\. not numbered");
    expect(escapeLineStart("---")).toBe("\\---");
    expect(escapeLineStart("===")).toBe("\\===");
    expect(escapeLineStart("-1 degrees")).toBe("-1 degrees");
  });
});

describe("renderInlineContent", () => {
  it("applies styles without letting markers touch whitespace", () => {
    expect(
      renderInlineContent(
        [
          text("plain "),
          text("bold ", { bold: true }),
          text("both", { bold: true, italic: true }),
          text(" gone", { strike: true }),
          text(" x", { underline: true }),
        ],
        context,
      ),
    ).toBe("plain **bold** ***both*** ~~gone~~ x");
  });

  it("merges neighbouring runs with the same style", () => {
    expect(
      renderInlineContent([text("a", { bold: true }), text("b", { bold: true })], context),
    ).toBe("**ab**");
  });

  it("fences code spans around backticks and leaves them unescaped", () => {
    expect(renderInlineContent([text("a*b", { code: true })], context)).toBe("`a*b`");
    expect(renderInlineContent([text("use `x`", { code: true })], context)).toBe("`` use `x` ``");
    expect(renderInlineContent([text("`x", { code: true })], context)).toBe("`` `x ``");
  });

  it("turns soft line breaks into hard breaks", () => {
    expect(renderInlineContent([text("one\ntwo")], context)).toBe("one\\\ntwo");
    expect(renderInlineContent([text("one\ntwo")], context, { inTable: true })).toBe("one<br>two");
  });

  it("writes note links as wikilinks, with an alias only when the text differs", () => {
    expect(renderInlineContent([link(`/notes?noteId=${LINKED_ID}`, "Project plan")], context)).toBe(
      "[[Project plan]]",
    );
    expect(renderInlineContent([link(`/notes?noteId=${LINKED_ID}`, "the plan")], context)).toBe(
      "[[Project plan|the plan]]",
    );
    expect(
      renderInlineContent([link(`/notes?noteId=${LINKED_ID}`, "a|b]]c")], context, {
        inTable: true,
      }),
    ).toBe("[[Project plan\\|a b  c]]");
    expect(renderInlineContent([link(`/notes?noteId=${MISSING_ID}`, "gone")], context)).toBe(
      "gone",
    );
  });

  it("turns video timestamps into YouTube links in both stored formats", () => {
    expect(
      renderInlineContent([link("#note-ref?kind=video-timestamp&seconds=754", "12:34")], context),
    ).toBe("[12:34](https://www.youtube.com/watch?v=abc123&t=754s)");
    expect(renderInlineContent([link("#note-video?t=5", "0:05")], context)).toBe(
      "[0:05](https://www.youtube.com/watch?v=abc123&t=5s)",
    );
    expect(
      renderInlineContent([link("#note-ref?kind=video-timestamp&seconds=5", "0:05")], {
        ...context,
        videoUrlAt: () => null,
      }),
    ).toBe("0:05");
  });

  it("keeps web and mail links and drops unsafe ones", () => {
    expect(renderInlineContent([link("https://example.com/a (b)", "site")], context)).toBe(
      "[site](https://example.com/a%20%28b%29)",
    );
    expect(renderInlineContent([link("mailto:me@example.com", "mail")], context)).toBe(
      "[mail](mailto:me@example.com)",
    );
    expect(renderInlineContent([link("javascript:alert(1)", "click")], context)).toBe("click");
    expect(renderInlineContent([link("#note-ref?kind=graph-node&target=x", "node")], context)).toBe(
      "node",
    );
  });

  it("ignores malformed content", () => {
    expect(renderInlineContent("nope", context)).toBe("");
    expect(renderInlineContent([null, 4, { type: "text" }, text("ok")], context)).toBe("ok");
  });
});

describe("renderBlocks", () => {
  it("renders headings, paragraphs, quotes and dividers", () => {
    expect(
      renderBlocks(
        [
          block("heading", [text("Title")], { level: 2 }),
          block("paragraph", [text("# literal hash")]),
          block("paragraph", []),
          block("quote", [text("first\nsecond")]),
          block("divider"),
          block("heading", [text("Too deep")], { level: 9 }),
        ],
        context,
      ),
    ).toBe(
      ["## Title", "\\# literal hash", "> first\\\n> second", "---", "###### Too deep"].join(
        "\n\n",
      ),
    );
  });

  it("nests lists under their marker and numbers from the start prop", () => {
    expect(
      renderBlocks(
        [
          block("bulletListItem", [text("parent")], {}, [
            block("checkListItem", [text("done")], { checked: true }),
            block("checkListItem", [text("todo")], { checked: false }),
          ]),
          block("bulletListItem", [text("sibling")]),
          block("paragraph", [text("between")]),
          block("numberedListItem", [text("three")], { start: 3 }),
          block("numberedListItem", [text("four")], {}, [block("paragraph", [text("child")])]),
          block("toggleListItem", [text("toggle")]),
        ],
        context,
      ),
    ).toBe(
      [
        "- parent\n  - [x] done\n  - [ ] todo\n- sibling",
        "between",
        "3. three\n4. four\n   child",
        "- toggle",
      ].join("\n\n"),
    );
  });

  it("fences code blocks longer than any backtick run inside", () => {
    expect(
      renderBlocks(
        [
          block("codeBlock", [text("const a = `x`;\n```")], { language: "typescript" }),
          block("codeBlock", [text("plain")], { language: "bad lang;" }),
        ],
        context,
      ),
    ).toBe("````typescript\nconst a = `x`;\n```\n````\n\n```badlang\nplain\n```");
  });

  it("renders tables with a header row and escaped cells", () => {
    const cell = (value: string) => ({ type: "tableCell", content: [text(value)], props: {} });
    expect(
      renderBlocks(
        [
          block("table", {
            type: "tableContent",
            columnWidths: [],
            rows: [
              { cells: [cell("Name"), cell("Notes")] },
              { cells: [[text("a|b")], [text("line\nbreak")]] },
              { cells: [cell("short")] },
            ],
          }),
        ],
        context,
      ),
    ).toBe("| Name | Notes |\n| --- | --- |\n| a\\|b | line<br>break |\n| short |   |");
  });

  it("links exported images, keeps remote ones and drops unknown references", () => {
    expect(
      renderBlocks(
        [
          block("image", [], { url: "abc.png", caption: "A [chart]" }),
          block("image", [], { url: "https://example.com/x.png", name: "remote" }),
          block("image", [], { url: "javascript:alert(1)" }),
          block("image", [], { url: "" }),
          block("file", [], { url: "https://example.com/doc.pdf", name: "Doc" }),
        ],
        context,
      ),
    ).toBe(
      "![A  chart ](attachments/abc.png)\n\n![remote](https://example.com/x.png)\n\n[Doc](https://example.com/doc.pdf)",
    );
  });

  it("flattens columns in order and keeps children of other blocks", () => {
    expect(
      renderBlocks(
        [
          block("columnList", [], {}, [
            block("column", [], {}, [block("paragraph", [text("left")])]),
            block("column", [], {}, [block("paragraph", [text("right")])]),
          ]),
          block("paragraph", [text("parent")], {}, [block("paragraph", [text("nested")])]),
          block("someFutureBlock", [text("still text")]),
        ],
        context,
      ),
    ).toBe("left\n\nright\n\nparent\n\nnested\n\nstill text");
  });

  it("returns nothing for non-arrays", () => {
    expect(renderBlocks(undefined, context)).toBe("");
    expect(renderBlocks([null, { nope: true }], context)).toBe("");
  });
});

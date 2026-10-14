// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  blocksOf,
  createEditor,
  createIdCounter,
  PNG_BASE64,
  textOf,
} from "../../__tests__/testKit";
import { convertEvernoteImport } from "../evernoteImport";

const editor = createEditor();
const createId = createIdCounter();
const PNG_HASH = createHash("md5").update(Buffer.from(PNG_BASE64, "base64")).digest("hex");
const PDF_BASE64 = Buffer.from("%PDF-1.4 fake").toString("base64");
const PDF_HASH = createHash("md5").update(Buffer.from(PDF_BASE64, "base64")).digest("hex");

const enml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note>${body}</en-note>`;

const enex = (notes: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">\n<en-export application="Evernote">${notes}</en-export>`;

const recipes = enex(`
<note>
  <title>Groceries</title>
  <content><![CDATA[${enml(
    [
      "<div><b>Shopping</b> list</div>",
      '<div><en-todo checked="true"/>Milk</div>',
      '<div><en-todo checked="false"/>Bread</div>',
      '<ul style="--en-todo:true;"><li style="--en-checked:true;"><div>Eggs</div></li><li><div>Butter</div></li></ul>',
      `<div><en-media hash="${PNG_HASH}" type="image/png"/></div>`,
      `<div><en-media hash="${PDF_HASH}" type="application/pdf"/></div>`,
      '<div style="--en-codeblock:true;"><div>const a = 1;</div><div>const b = 2;</div></div>',
      '<div><en-crypt hint="pw">c2VjcmV0</en-crypt></div>',
      "<script>window.hacked = true;</script>",
      '<div><a href="https://example.com">a site</a> and <a href="evernote:///view/1/s1/abc/abc/">another note</a></div>',
    ].join(""),
  )}]]></content>
  <created>20201231T120000Z</created>
  <tag>food</tag>
  <tag>weekly</tag>
  <note-attributes><source-url>https://example.com/list</source-url></note-attributes>
  <resource>
    <data encoding="base64">
${PNG_BASE64}
    </data>
    <mime>image/png</mime>
    <resource-attributes><file-name>receipt.png</file-name></resource-attributes>
  </resource>
  <resource>
    <data encoding="base64">${PDF_BASE64}</data>
    <mime>application/pdf</mime>
    <resource-attributes><file-name>menu.pdf</file-name></resource-attributes>
  </resource>
</note>
<note>
  <title></title>
  <content><![CDATA[${enml("<div>No title here</div>")}]]></content>
</note>`);

const runImport = async () => {
  const saved: number[] = [];
  const output = await convertEvernoteImport({
    files: [
      { path: "Recipes.enex", text: recipes },
      { path: "Broken.enex", text: "<en-export><note>" },
    ],
    createId,
    parseHtml: (html) => editor.tryParseHTMLToBlocks(html),
    saveImageBytes: async (bytes) => {
      saved.push(bytes.length);
      return "loam-media://images/saved.png";
    },
  });
  return { ...output, saved };
};

describe("convertEvernoteImport", () => {
  it("creates one note per Evernote note, in a folder named after the notebook", async () => {
    const { notes, skipped } = await runImport();
    expect(notes.map((note) => [note.title, note.folder])).toEqual([
      ["Groceries", "Recipes"],
      ["Untitled", "Recipes"],
    ]);
    expect(skipped).toEqual(
      expect.arrayContaining([
        { path: "Broken.enex", reason: "Not a valid Evernote export" },
        {
          path: "Recipes/Groceries: menu.pdf",
          reason: "Attachments other than images are not imported",
        },
        { path: "Recipes/Groceries: Encrypted text", reason: "Encrypted text can't be imported" },
      ]),
    );
  });

  it("keeps formatting, both checklist styles and code blocks", async () => {
    const blocks = blocksOf((await runImport()).notes[0]!);
    expect(blocks[0]).toMatchObject({ type: "paragraph" });
    expect(blocks[0]!.content?.[0]).toMatchObject({ text: "Shopping", styles: { bold: true } });
    const checklist = blocks
      .filter((block) => block.type === "checkListItem")
      .map((block) => [textOf(block), block.props.checked]);
    expect(checklist).toEqual([
      ["Milk", true],
      ["Bread", false],
      ["Eggs", true],
      ["Butter", false],
    ]);
    const code = blocks.find((block) => block.type === "codeBlock");
    expect(code && textOf(code)).toBe("const a = 1;\nconst b = 2;");
  });

  it("copies attached images found by their MD5 and keeps other attachments as text", async () => {
    const { notes, saved } = await runImport();
    const blocks = blocksOf(notes[0]!);
    expect(saved).toEqual([Buffer.from(PNG_BASE64, "base64").length]);
    expect(blocks.find((block) => block.type === "image")?.props).toMatchObject({
      url: "loam-media://images/saved.png",
      name: "receipt.png",
    });
    const texts = blocks.map(textOf);
    expect(texts).toContain("Attachment not imported: menu.pdf");
    expect(texts).toContain("Encrypted text was not imported.");
  });

  it("drops scripts, keeps web links and turns Evernote note links into text", async () => {
    const blocks = blocksOf((await runImport()).notes[0]!);
    const serialized = JSON.stringify(blocks);
    expect(serialized).not.toContain("hacked");
    const linkLine = blocks.find((block) => textOf(block).includes("a site"))!;
    expect(
      linkLine.content?.filter((item) => item.type === "link").map((item) => item.href),
    ).toEqual(["https://example.com"]);
    expect(textOf(linkLine)).toBe("a site and another note");
  });

  it("keeps text that follows a self-closing Evernote tag", async () => {
    const { notes } = await convertEvernoteImport({
      files: [
        {
          path: "Inbox.enex",
          text: enex(
            `<note><title>Inline</title><content><![CDATA[${enml(
              `<div>Before <en-media hash="${PNG_HASH}" type="image/png"/>after the image</div>`,
            )}]]></content><resource><data>${PNG_BASE64}</data><mime>image/png</mime></resource></note>`,
          ),
        },
      ],
      createId,
      parseHtml: (html) => editor.tryParseHTMLToBlocks(html),
      saveImageBytes: async () => "loam-media://images/saved.png",
    });
    expect(JSON.stringify(blocksOf(notes[0]!))).toContain("after the image");
  });

  it("adds the tags and source page as text at the end", async () => {
    const texts = blocksOf((await runImport()).notes[0]!).map(textOf);
    expect(texts.slice(-2)).toEqual(["Tags: food, weekly", "Source: https://example.com/list"]);
  });
});

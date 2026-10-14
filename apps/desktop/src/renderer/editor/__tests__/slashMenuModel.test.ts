// @vitest-environment jsdom

import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { BlockNoteEditor } from "@blocknote/core";
import { en } from "@blocknote/core/locales";
import { blockTypeSelectItems } from "@blocknote/react";
import { afterEach, describe, expect, it } from "vitest";

import { getDefaultEditorSlashMenuItems } from "../defaultSlashMenuItems";
import { noteEditorSchema } from "../noteEditorSchema";
import {
  buildSlashMenuItems,
  isSlashQueryAbandoned,
  isValidSlashTrigger,
  loadRecentSlashMenuIds,
  offeredBlockTypeItems,
  trackRecentSlashMenuItem,
  type SlashCommand,
} from "../slashMenuModel";

const command = (key: SlashCommand["key"], title: string, aliases: string[] = []) => ({
  key,
  title,
  aliases,
  onItemClick: () => {},
});

const commands = [
  command("paragraph", "Paragraph", ["p"]),
  command("heading", "Heading 1", ["h1"]),
  command("bullet_list", "Bullet List", ["ul"]),
  command("check_list", "Check List", ["todo"]),
  command("image", "Image", ["picture"]),
  command("columns_2", "Two Columns"),
  command("note_link", "Link to note"),
];

const rows = (items: ReturnType<typeof buildSlashMenuItems>) =>
  items.map((item) => `${item.section}: ${item.title}`);

afterEach(() => localStorage.clear());

describe("buildSlashMenuItems", () => {
  it("groups every command by section when nothing is typed", () => {
    expect(rows(buildSlashMenuItems({ items: commands, query: "" }))).toEqual([
      "Basic blocks: Heading 1",
      "Basic blocks: Paragraph",
      "Lists: Bullet List",
      "Lists: Check List",
      "Media: Image",
      "Layout: Two Columns",
      "Notes: Link to note",
    ]);
  });

  it("keeps commands matching the query, the section with the best match first", () => {
    expect(rows(buildSlashMenuItems({ items: commands, query: "li" }))).toEqual([
      "Notes: Link to note",
      "Lists: Bullet List",
      "Lists: Check List",
    ]);
    expect(rows(buildSlashMenuItems({ items: commands, query: "todo" }))).toEqual([
      "Lists: Check List",
    ]);
    expect(buildSlashMenuItems({ items: commands, query: "zzz" })).toEqual([]);
  });

  it("puts an exact match first, ahead of loose matches in earlier sections", () => {
    const items = [
      command("toggle_list", "Toggle List"),
      command("table", "Table"),
      { ...command("heading_3", "Heading 3"), subtext: "Used for subsections and group headings" },
    ];
    expect(rows(buildSlashMenuItems({ items, query: "table" }))[0]).toBe("Layout: Table");
    // A description holds the letters of almost any word, so it needs the whole query.
    expect(buildSlashMenuItems({ items, query: "code" })).toEqual([]);
    expect(rows(buildSlashMenuItems({ items, query: "subsection" }))).toEqual([
      "Basic blocks: Heading 3",
    ]);
  });

  it("leaves recently used commands in their sections once a query is typed", () => {
    const items = buildSlashMenuItems({ items: commands, query: "i", recentIds: ["image"] });
    expect(rows(items)).toContain("Media: Image");
    expect(rows(items).some((row) => row.startsWith("Recent"))).toBe(false);
  });

  it("lifts recently used commands into a Recent section", () => {
    const items = buildSlashMenuItems({
      items: commands,
      query: "",
      recentIds: ["image", "check_list"],
    });
    expect(rows(items).slice(0, 3)).toEqual([
      "Recent: Check List",
      "Recent: Image",
      "Basic blocks: Heading 1",
    ]);
    expect(rows(items)).not.toContain("Media: Image");
  });

  it("ranks the section of the cursor's block higher among equal matches", () => {
    const items = buildSlashMenuItems({
      items: commands,
      query: "e",
      contextBlockType: "bulletListItem",
    });
    expect(items[0]?.section).toBe("Lists");
  });

  it("gives each command the sample its preview shows", () => {
    const items = buildSlashMenuItems({ items: commands, query: "" });
    const previews = Object.fromEntries(items.map((item) => [item.key, item.preview]));
    expect(previews).toMatchObject({
      heading: "heading-1",
      columns_2: "columns-2",
      note_link: "generic",
    });
  });
});

describe("recent slash commands", () => {
  it("remembers the last few commands, newest first and without repeats", () => {
    for (const id of ["a", "b", "a", "c", "d", "e", "f"]) trackRecentSlashMenuItem(id);
    expect(loadRecentSlashMenuIds()).toEqual(["f", "e", "d", "c", "a"]);
  });

  it("ignores a corrupted store", () => {
    localStorage.setItem("loam:slash-menu-recents", "{not json");
    expect(loadRecentSlashMenuIds()).toEqual([]);
  });
});

describe("isSlashQueryAbandoned", () => {
  it("closes the menu on a space right after the slash", () => {
    expect(isSlashQueryAbandoned(" ")).toBe(true);
    expect(isSlashQueryAbandoned("heading 1")).toBe(false);
    expect(isSlashQueryAbandoned("")).toBe(false);
  });
});

describe("isValidSlashTrigger", () => {
  const schema = new Schema({
    nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} },
  });
  const stateWithText = (text: string) => {
    const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text(text)])]);
    return EditorState.create({ doc, selection: TextSelection.create(doc, text.length + 1) });
  };

  it("accepts a slash at the start of a block or after a space", () => {
    expect(isValidSlashTrigger(stateWithText("/"))).toBe(true);
    expect(isValidSlashTrigger(stateWithText("note /hea"))).toBe(true);
  });

  it("rejects a slash inside a word or URL", () => {
    expect(isValidSlashTrigger(stateWithText("and/or"))).toBe(false);
    expect(isValidSlashTrigger(stateWithText("https://"))).toBe(false);
  });
});

describe("the blocks notes offer", () => {
  const editor = BlockNoteEditor.create({
    schema: noteEditorSchema,
    dictionary: en,
  });

  it("leaves code, small headings and non-image files out of the slash menu", () => {
    const keys = getDefaultEditorSlashMenuItems(editor).map((item) => item.key);
    expect(keys).toEqual(expect.arrayContaining(["heading_3", "image", "columns_2", "emoji"]));
    for (const hidden of ["code_block", "heading_4", "video", "audio", "file"]) {
      expect(keys).not.toContain(hidden);
    }
  });

  it("offers the same headings in the formatting toolbar", () => {
    const names = offeredBlockTypeItems(blockTypeSelectItems(en), en).map((item) => item.name);
    expect(names).toContain("Heading 3");
    expect(names).toContain("Toggle Heading 1");
    expect(names).not.toContain("Heading 4");
    expect(names).not.toContain("Heading 6");
  });
});

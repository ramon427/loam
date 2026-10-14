// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { encodeNoteGraphSnapshot } from "@loam/shared/notes/noteGraphSnapshot";

import {
  decidePaste,
  stripPastedHtmlImages,
  stripPastedMarkdownImages,
  type Clipboard,
} from "../editorPaste";

const clipboard = (
  data: Record<string, string>,
  files: Clipboard["files"] = [],
  items: Clipboard["items"] = [],
): Clipboard => ({
  types: Object.keys(data),
  getData: (format) => data[format] ?? "",
  files,
  items,
});

describe("decidePaste", () => {
  it("pastes BlockNote's own copy as is, even when its HTML twin has images", () => {
    const copied = clipboard({
      "blocknote/html": '<div data-content-type="image" data-url="3f1c.png"></div>',
      "text/html": '<img src="loam-media://images/3f1c.png">',
      "text/plain": "![](3f1c.png)",
    });
    expect(decidePaste(copied)).toEqual({ kind: "default" });
  });

  it("turns a copied graph snapshot into a snapshot block", () => {
    const snapshot = {
      noteId: "11111111-1111-4111-8111-111111111111",
      tabId: "graph",
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    };
    const action = decidePaste(clipboard({ "text/plain": encodeNoteGraphSnapshot(snapshot) }));
    expect(action).toEqual({ kind: "graphSnapshot", snapshot });
  });

  it("lets BlockNote upload a pasted image file", () => {
    const files = [{ name: "shot.png", type: "image/png" }];
    expect(decidePaste(clipboard({}, files))).toEqual({ kind: "image" });
    const items = [{ kind: "file", type: "image/webp" }];
    expect(decidePaste(clipboard({}, [], items))).toEqual({ kind: "image" });
  });

  it("drops images from external HTML and Markdown but keeps the text", () => {
    expect(
      decidePaste(clipboard({ "text/html": '<p>Hello <img src="https://x.test/a.png"></p>' })),
    ).toEqual({ kind: "html", html: "<p>Hello </p>" });
    expect(decidePaste(clipboard({ "text/markdown": "Hi ![a](https://x.test/a.png)" }))).toEqual({
      kind: "markdown",
      markdown: "Hi",
    });
    expect(decidePaste(clipboard({ "text/plain": "![a](a.png) notes" }))).toEqual({
      kind: "markdown",
      markdown: "notes",
    });
  });

  it("pastes nothing when the clipboard holds only external images", () => {
    expect(decidePaste(clipboard({ "text/html": '<img src="https://x.test/a.png">' }))).toEqual({
      kind: "nothing",
    });
  });

  it("leaves ordinary text to BlockNote", () => {
    expect(decidePaste(clipboard({ "text/html": "<p>Plain</p>", "text/plain": "Plain" }))).toEqual({
      kind: "default",
    });
    expect(decidePaste(null)).toEqual({ kind: "default" });
  });
});

describe("stripPastedHtmlImages", () => {
  it("removes scripts, handlers, styles and unsafe links along with images", () => {
    const html = stripPastedHtmlImages(
      '<p style="color:red" onclick="x()">Text <a href="javascript:alert(1)">link</a></p>' +
        '<script>alert(1)</script><img src="a.png"><a href="https://ok.test">ok</a>',
    );
    expect(html).toBe('<p>Text <a>link</a></p><a href="https://ok.test">ok</a>');
  });

  it("leaves HTML without images to BlockNote", () => {
    expect(stripPastedHtmlImages("<p>Text</p>")).toBeNull();
  });
});

describe("stripPastedMarkdownImages", () => {
  it("removes inline and reference images", () => {
    expect(stripPastedMarkdownImages("a ![x](y.png) b ![z][ref] c")).toBe("a  b  c");
    expect(stripPastedMarkdownImages("no images")).toBeNull();
  });
});

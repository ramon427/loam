// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import type { BridgeImportImageRequest } from "@loam/shared/bridge/loamBridge";

import {
  blocksOf,
  createEditor,
  createIdCounter,
  PNG_BASE64,
  textOf,
} from "../../__tests__/testKit";
import { convertHtmlImport } from "../htmlImport";

const editor = createEditor();
const createId = createIdCounter();
const PNG_DATA = `data:image/png;base64,${PNG_BASE64}`;
const SVG_DATA = `data:image/svg+xml;base64,${btoa("<svg/>")}`;

const files = [
  {
    path: "Trip.html",
    text: [
      "<html><head><title>Trip</title><script>window.hacked = true</script></head><body>",
      "<h1>Trip</h1>",
      "<p>See the <a href='Packing%20list.html'>packing list</a> and <a href='https://example.com'>a site</a>.</p>",
      "<img src='Trip_files/map.png' alt='map'>",
      `<img src='${PNG_DATA}' alt='embedded'>`,
      `<img src='${SVG_DATA}' alt='vector'>`,
      "</body></html>",
    ].join(""),
  },
  {
    path: "Packing list.html",
    text: "<html><body><h1>Packing list</h1><ul><li>Socks</li><li>Charger</li></ul></body></html>",
  },
  { path: "notes.txt", text: "x" },
];

const runImport = async () => {
  const requests: BridgeImportImageRequest[] = [];
  const saved: string[] = [];
  const output = await convertHtmlImport({
    files,
    createId,
    parseHtml: (html) => editor.tryParseHTMLToBlocks(html),
    saveImages: async (batch) => {
      requests.push(...batch);
      return batch.map(() => ({ url: "loam-media://images/map.png" }));
    },
    // Like the real media store, only raster images are accepted, by their bytes.
    saveImageBytes: async (bytes) => {
      const isPng = bytes[0] === 0x89 && new TextDecoder().decode(bytes.subarray(1, 4)) === "PNG";
      saved.push(isPng ? "png" : new TextDecoder().decode(bytes));
      if (!isPng) throw new Error("Unsupported image type.");
      return "loam-media://images/embedded.png";
    },
  });
  return { ...output, requests, saved };
};

describe("convertHtmlImport", () => {
  it("creates one note per page, titled from the page, without repeating the title", async () => {
    const { notes, skipped } = await runImport();
    expect(notes.map((note) => note.title)).toEqual(["Trip", "Packing list"]);
    expect(blocksOf(notes[0]!).some((block) => block.type === "heading")).toBe(false);
    expect(blocksOf(notes[1]!).map(textOf)).toEqual(["Socks", "Charger"]);
    expect(skipped).toEqual(
      expect.arrayContaining([{ path: "notes.txt", reason: "Not an HTML file" }]),
    );
  });

  it("links the picked pages to each other and keeps web links", async () => {
    const { notes } = await runImport();
    const links = blocksOf(notes[0]!)[0]!.content!.filter((item) => item.type === "link");
    expect(links.map((link) => link.href)).toEqual([
      `/notes?noteId=${notes[1]!.id}`,
      "https://example.com",
    ]);
  });

  it("copies images beside the page and embedded ones, and drops scripts", async () => {
    const { notes, requests, saved, skipped } = await runImport();
    const blocks = blocksOf(notes[0]!);
    expect(requests).toEqual([{ fromPath: "Trip.html", reference: "Trip_files/map.png" }]);
    expect(saved).toEqual(["png", "<svg/>"]);
    expect(
      blocks.filter((block) => block.type === "image").map((block) => block.props.url),
    ).toEqual(["loam-media://images/map.png", "loam-media://images/embedded.png"]);
    // The refused vector image becomes a short note, never the raw data URL.
    expect(blocks.map(textOf)).toContain("Image not found: embedded image");
    expect(JSON.stringify(blocks)).not.toContain("data:image");
    expect(JSON.stringify(blocks)).not.toContain("hacked");
    expect(skipped).toContainEqual({
      path: "Trip.html: embedded image",
      reason: "Unsupported image type.",
    });
  });
});

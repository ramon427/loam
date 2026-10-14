import { describe, expect, it } from "vitest";

import { listZipEntries } from "../zipArchive";
import { buildZip } from "./zipFixture";

describe("listZipEntries", () => {
  it("reads stored and deflated files and skips folders", () => {
    const zip = buildZip([
      { name: "Notes/" },
      { name: "Notes/Plan.md", content: "# Plan", deflate: true },
      { name: "Notes/raw.txt", content: "raw" },
      { name: "empty.md" },
    ]);
    const entries = listZipEntries(zip);
    expect(entries.map((entry) => [entry.path, entry.size])).toEqual([
      ["Notes/Plan.md", 6],
      ["Notes/raw.txt", 3],
      ["empty.md", 0],
    ]);
    expect(entries.map((entry) => entry.read().toString())).toEqual(["# Plan", "raw", ""]);
  });

  it("skips paths that leave the archive and encrypted files", () => {
    const zip = buildZip([
      { name: "../escape.md", content: "x" },
      { name: "a/../../escape.md", content: "x" },
      { name: "/etc/passwd", content: "x" },
      { name: "C:/Windows/evil.md", content: "x" },
      { name: "secret.md", content: "x", encrypted: true },
      { name: "./ok.md", content: "fine" },
    ]);
    // A leading slash is dropped rather than trusted, so it stays inside.
    expect(listZipEntries(zip).map((entry) => entry.path)).toEqual(["etc/passwd", "ok.md"]);
  });

  it("refuses data that inflates past its declared size", () => {
    const zip = buildZip([
      { name: "bomb.md", content: "a".repeat(100_000), deflate: true, declaredSize: 10 },
    ]);
    const [entry] = listZipEntries(zip);
    expect(() => entry!.read()).toThrow(/damaged/);
  });

  it("rejects files that are not zip archives", () => {
    expect(() => listZipEntries(Buffer.from("not a zip at all, just text"))).toThrow(
      /not a zip archive/,
    );
  });
});

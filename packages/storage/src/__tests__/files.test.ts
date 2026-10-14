import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isInsideDirectory, readIfExists, writeFileAtomic } from "../files";
import { createTempDirectories } from "../testing/tempDirectories";

const tempDirectory = createTempDirectories("loam-files-");

describe("writeFileAtomic", () => {
  it("replaces a file and leaves nothing else behind", async () => {
    const directory = tempDirectory();
    const path = join(directory, "settings.json");
    writeFileSync(path, "old");
    await writeFileAtomic(path, "new");
    expect(readFileSync(path, "utf8")).toBe("new");
    expect(readdirSync(directory)).toEqual(["settings.json"]);
  });

  it.skipIf(process.platform === "win32")("gives a replaced file the mode asked for", async () => {
    const path = join(tempDirectory(), "key.json");
    writeFileSync(path, "old", { mode: 0o644 });
    await writeFileAtomic(path, "secret", { mode: 0o600 });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("cleans up when the write fails", async () => {
    const directory = tempDirectory();
    await expect(writeFileAtomic(join(directory, "missing", "a.json"), "x")).rejects.toThrow();
    expect(readdirSync(directory)).toEqual([]);
  });
});

describe("readIfExists", () => {
  it("reads what exists and gives null for what doesn't", async () => {
    const directory = tempDirectory();
    writeFileSync(join(directory, "a.txt"), "a");
    expect(await readIfExists(readFile(join(directory, "a.txt"), "utf8"))).toBe("a");
    expect(await readIfExists(readFile(join(directory, "b.txt"), "utf8"))).toBeNull();
    expect(await readIfExists(readdir(join(directory, "nothing")))).toBeNull();
    await expect(readIfExists(readFile(directory, "utf8"))).rejects.toMatchObject({
      code: "EISDIR",
    });
  });
});

describe("isInsideDirectory", () => {
  it("accepts only paths strictly inside the directory", () => {
    const root = join(tmpdir(), "root");
    expect(isInsideDirectory(root, join(root, "a", "b.md"))).toBe(true);
    expect(isInsideDirectory(root, join(root, "..notes"))).toBe(true);
    expect(isInsideDirectory(root, root)).toBe(false);
    expect(isInsideDirectory(root, join(root, ".."))).toBe(false);
    expect(isInsideDirectory(root, join(root, "..", "other"))).toBe(false);
    expect(isInsideDirectory(root, `${root}-sibling`)).toBe(false);
  });
});

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCustomizations } from "../customizations";

let dataDirectory: string;

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "loam-customizations-"));
});

afterEach(async () => {
  await rm(dataDirectory, { recursive: true, force: true });
});

const create = () => createCustomizations({ dataDirectory, onChange: () => undefined });

describe("customizations", () => {
  it("lists nothing when the folders don't exist yet", async () => {
    expect(await create().list()).toEqual({ themes: [], snippets: [] });
  });

  it("reads theme files and says why one can't be used", async () => {
    await mkdir(join(dataDirectory, "themes"));
    await writeFile(
      join(dataDirectory, "themes", "dusk.json"),
      JSON.stringify({ id: "dusk", name: "Dusk", dark: { tokens: { accent: "#f0a060" } } }),
    );
    await writeFile(join(dataDirectory, "themes", "broken.json"), "{ not json");
    await writeFile(
      join(dataDirectory, "themes", "sneaky.json"),
      JSON.stringify({ id: "sneaky", name: "S", light: { tokens: { text: "red;}" } } }),
    );
    await writeFile(join(dataDirectory, "themes", "notes.txt"), "ignored");

    const { themes } = await create().list();

    expect(themes.map((entry) => entry.file)).toEqual(["broken.json", "dusk.json", "sneaky.json"]);
    expect(themes[0]).toEqual({
      file: "broken.json",
      ok: false,
      error: "The file is not valid JSON.",
    });
    expect(themes[1]).toMatchObject({ ok: true, theme: { id: "dusk", name: "Dusk" } });
    expect(themes[2]).toMatchObject({
      ok: false,
      error: expect.stringContaining("light.tokens.text"),
    });
  });

  it("reads snippets as written, in name order", async () => {
    await mkdir(join(dataDirectory, "snippets"));
    await writeFile(join(dataDirectory, "snippets", "b.css"), "b{}");
    await writeFile(join(dataDirectory, "snippets", "a.css"), "a{}");
    await mkdir(join(dataDirectory, "snippets", "nested.css"));

    expect((await create().list()).snippets).toEqual([
      { file: "a.css", css: "a{}" },
      { file: "b.css", css: "b{}" },
    ]);
  });

  it("skips a file over the size limit", async () => {
    await mkdir(join(dataDirectory, "snippets"));
    await writeFile(join(dataDirectory, "snippets", "huge.css"), "a".repeat(300 * 1024));
    expect((await create().list()).snippets).toEqual([]);
  });
});

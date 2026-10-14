import { describe, expect, it } from "vitest";

import { buildFrontMatter, parseFrontMatter } from "../frontMatter";

describe("parseFrontMatter", () => {
  it("reads back what the exporter writes", () => {
    const title = 'Plan: "v2" #draft';
    const { fields, body } = parseFrontMatter(
      `${buildFrontMatter({ title, "loam-id": "abc", updated: "2026-10-10" })}\nBody`,
    );
    expect(fields).toEqual({ title, "loam-id": "abc", updated: "2026-10-10" });
    expect(body).toBe("\nBody");
  });

  it("reads hand-written YAML: bare and single-quoted values, both list styles, a BOM", () => {
    const { fields, body } = parseFrontMatter(
      [
        "\uFEFF---",
        "title: It's here",
        "quoted: 'It''s quoted'",
        "aliases:",
        "  - Home",
        "  - Start",
        "tags: [one, two]",
        "nested:",
        "  key: ignored",
        "---",
        "# Heading",
      ].join("\n"),
    );
    expect(fields).toEqual({
      title: "It's here",
      quoted: "It's quoted",
      aliases: ["Home", "Start"],
      tags: ["one", "two"],
      nested: [],
    });
    expect(body).toBe("# Heading");
  });

  it("leaves notes without front matter alone", () => {
    expect(parseFrontMatter("# Title\n---\nnot front matter")).toEqual({
      fields: {},
      body: "# Title\n---\nnot front matter",
    });
  });
});

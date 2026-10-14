import { describe, expect, it } from "vitest";

import { compileSnippetsCss, sanitizeSnippetCss } from "../snippetCss";

describe("sanitizeSnippetCss", () => {
  it("keeps ordinary rules as written", () => {
    const css = ".loam-sidebar { width: 280px; color: var(--app-text); }";
    expect(sanitizeSnippetCss(css)).toBe(css);
  });

  it("removes imports", () => {
    expect(sanitizeSnippetCss('@import url("https://x.test/a.css");\nbody{}')).toBe("\nbody{}");
  });

  it.each(['url("https://x.test/a.png")', "url('//x.test/a.png')", "url(https://x.test/a.png)"])(
    "blocks the address in %s",
    (value) => {
      expect(sanitizeSnippetCss(`a{background:${value}}`)).toBe("a{background:none}");
    },
  );

  it("keeps data: addresses", () => {
    const css = 'a{background:url("data:image/png;base64,AAAA")}';
    expect(sanitizeSnippetCss(css)).toBe(css);
  });

  it("drops escapes, so none can spell url(", () => {
    const css = sanitizeSnippetCss("a{background:\\75rl(https://x.test/a.png)}");
    expect(css).not.toContain("\\");
    expect(css).not.toMatch(/url\(/i);
  });

  it("blocks functions that take a bare string address", () => {
    expect(sanitizeSnippetCss('a{background:image-set("https://x.test/a.png" 1x)}')).toContain(
      "blocked-address(",
    );
  });
});

describe("compileSnippetsCss", () => {
  it("joins snippets under their file names, which can't close the comment", () => {
    expect(
      compileSnippetsCss([
        { file: "a*/.css", css: "a{}" },
        { file: "b.css", css: "b{}" },
      ]),
    ).toBe("/* a.css */\na{}\n/* b.css */\nb{}");
  });
});

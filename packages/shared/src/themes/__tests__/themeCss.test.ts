import { describe, expect, it } from "vitest";

import { compileThemeCss, readableOn, tokensFromPalette } from "../themeCss";
import { themeManifestSchema } from "../themeSchema";
import { THEME_TOKEN_NAMES } from "../themeTokens";

const palette = {
  background: "#1e1e2e",
  surface: "#232336",
  text: "#cdd6f4",
  muted: "#9399b2",
  border: "#313244",
  accent: "#cba6f7",
};

describe("themeManifestSchema", () => {
  it("accepts a theme with a palette and token overrides", () => {
    const result = themeManifestSchema.safeParse({
      id: "mocha",
      name: "Mocha",
      dark: { palette, tokens: { accent: "oklch(0.7 0.1 300)" } },
    });
    expect(result.success).toBe(true);
  });

  it("needs a light or a dark mode", () => {
    expect(themeManifestSchema.safeParse({ id: "empty", name: "Empty" }).success).toBe(false);
  });

  it.each([
    ["url()", "url(https://example.com/x.png)"],
    ["a declaration break", "red; background: blue"],
    ["a block break", "red} body{display:none"],
    ["an at-rule", "@import 'x'"],
    ["quotes", '"red"'],
  ])("refuses a value with %s", (_, value) => {
    const result = themeManifestSchema.safeParse({
      id: "bad",
      name: "Bad",
      light: { tokens: { text: value } },
    });
    expect(result.success).toBe(false);
  });

  it("refuses a token the app does not have", () => {
    const result = themeManifestSchema.safeParse({
      id: "bad",
      name: "Bad",
      light: { tokens: { "not-a-token": "#fff" } },
    });
    expect(result.success).toBe(false);
  });

  it("refuses a palette colour that isn't hex", () => {
    const result = themeManifestSchema.safeParse({
      id: "bad",
      name: "Bad",
      light: { palette: { ...palette, accent: "purple" } },
    });
    expect(result.success).toBe(false);
  });
});

describe("tokensFromPalette", () => {
  it("derives every colour token but the status ones it was not given", () => {
    const tokens = tokensFromPalette(palette, "dark");
    const statuses = ["success", "warning", "danger", "info"];
    expect(Object.keys(tokens).sort()).toEqual(
      THEME_TOKEN_NAMES.filter((name) => !statuses.includes(name)).sort(),
    );
    expect(tokens.accent).toBe("#cba6f7");
    expect(tokens["accent-foreground"]).toBe("#141414");
  });

  it("keeps a given accent text colour", () => {
    expect(
      tokensFromPalette({ ...palette, accentText: "#ffffff" }, "dark")["accent-foreground"],
    ).toBe("#ffffff");
  });
});

describe("readableOn", () => {
  it("picks dark text on light colours and light text on dark ones", () => {
    expect(readableOn("#ffffff")).toBe("#141414");
    expect(readableOn("#0f0f0f")).toBe("#fafafa");
    expect(readableOn("#fff")).toBe("#141414");
  });
});

describe("compileThemeCss", () => {
  it("is empty for Loam's own colours with nothing chosen over them", () => {
    expect(compileThemeCss({ id: "loam", name: "Loam", light: {}, dark: {} })).toBe("");
  });

  it("writes each mode under a selector that outranks app.css", () => {
    const css = compileThemeCss({
      id: "t",
      name: "T",
      light: { tokens: { text: "#111111" } },
      dark: { tokens: { text: "#eeeeee", success: "#00ff00" } },
    });
    expect(css).toContain(":root:not(.dark){--app-text:#111111;}");
    expect(css).toContain(":root.dark{--app-text:#eeeeee;--status-success:#00ff00;}");
  });

  it("leaves out a mode the theme does not have", () => {
    const css = compileThemeCss({ id: "t", name: "T", light: { tokens: { text: "#111111" } } });
    expect(css).not.toContain(":root.dark");
  });

  it("lays an accent over both modes with readable text on it", () => {
    const css = compileThemeCss(null, { accent: "#ffcc00" });
    expect(css).toContain(
      ":root:not(.dark){--app-accent:#ffcc00;--app-accent-2:#ffcc00;--app-accent-foreground:#141414;}",
    );
    expect(css).toContain(":root.dark{--app-accent:#ffcc00;");
  });

  it("ignores an accent that isn't hex and fonts that could break out", () => {
    const css = compileThemeCss(null, {
      accent: "red;}",
      fonts: { ui: '"Inter", sans-serif', code: "x;} body{display:none" },
    });
    expect(css).toBe(':root:root{--font-ui:"Inter", sans-serif;}');
  });
});

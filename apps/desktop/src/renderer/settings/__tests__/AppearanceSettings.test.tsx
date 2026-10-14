// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BridgeCustomizations } from "@loam/shared/bridge/loamBridge";

import { installFakeBridge } from "../../testing/fakeBridge";
import { reloadCustomizations } from "../../themes/customizations";
import { AppearanceSettings } from "../AppearanceSettings";

const files: BridgeCustomizations = {
  themes: [
    {
      file: "dusk.json",
      ok: true,
      theme: { id: "dusk", name: "Dusk", dark: { tokens: { accent: "#f0a060" } } },
    },
    { file: "broken.json", ok: false, error: "The file is not valid JSON." },
  ],
  snippets: [
    { file: "wide.css", css: '.loam-sidebar{width:320px;background:url("https://x.test")}' },
  ],
};

const themeSheet = () => document.getElementById("loam-theme")?.textContent ?? "";
const snippetSheet = () => document.getElementById("loam-snippets")?.textContent ?? "";

beforeEach(async () => {
  localStorage.clear();
  // The window shows dark, as theme-init.js would have set it.
  document.documentElement.className = "dark";
  document.documentElement.dataset.theme = "dark";
  installFakeBridge({ "customizations.list": () => files });
  await act(() => reloadCustomizations());
});

afterEach(() => {
  document.getElementById("loam-theme")?.remove();
  document.getElementById("loam-snippets")?.remove();
});

describe("AppearanceSettings", () => {
  it("lists the presets and the library's theme files", () => {
    render(<AppearanceSettings />);
    expect(screen.getByTestId("theme-card-loam").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("theme-card-nord")).toBeTruthy();
    expect(screen.getByTestId("theme-card-dusk").textContent).toContain("Dark only");
    expect(screen.getByText("The file is not valid JSON.")).toBeTruthy();
  });

  it("lays a chosen theme over the tokens and caches it for the next start", () => {
    render(<AppearanceSettings />);
    fireEvent.click(screen.getByTestId("theme-card-nord"));

    expect(screen.getByTestId("theme-card-nord").getAttribute("aria-checked")).toBe("true");
    expect(themeSheet()).toContain(":root.dark{--app-page:#2e3440;");
    expect(localStorage.getItem("loam:theme-css")).toBe(themeSheet());
    expect(JSON.parse(localStorage.getItem("loam:appearance")!)).toEqual({ themeId: "nord" });
  });

  it("switches a snippet on, without its remote address", async () => {
    render(<AppearanceSettings />);
    expect(snippetSheet()).toBe("");

    fireEvent.click(screen.getByRole("checkbox", { name: "Use wide.css" }));

    await waitFor(() => expect(snippetSheet()).toContain(".loam-sidebar{width:320px;"));
    expect(snippetSheet()).toContain("background:none");
    expect(snippetSheet()).not.toContain("x.test");
  });

  it("keeps the sheets last in the head, after stylesheets added later", () => {
    render(<AppearanceSettings />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Use wide.css" }));
    const late = document.createElement("style");
    document.head.append(late);
    return waitFor(() => expect(document.head.lastElementChild?.id).toBe("loam-snippets"));
  });
});

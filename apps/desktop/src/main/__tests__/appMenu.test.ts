import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";

import { macAppMenuTemplate } from "../appMenu";

const submenuOf = (template: MenuItemConstructorOptions[], label: string) => {
  const menu = template.find((item) => item.label === label || item.role === label);
  return (menu?.submenu ?? []) as MenuItemConstructorOptions[];
};

const rolesOf = (items: MenuItemConstructorOptions[]) =>
  items.filter((item) => item.type !== "separator").map((item) => item.role ?? item.label);

const template = (developerTools = false, openExternal = vi.fn()) =>
  macAppMenuTemplate({ appName: "Loam", developerTools, openExternal });

describe("macAppMenuTemplate", () => {
  it("names the app menu after the app, with About, Hide and Quit", () => {
    const menu = template();
    expect(menu[0]?.label).toBe("Loam");
    expect(rolesOf(submenuOf(menu, "Loam"))).toEqual([
      "about",
      "services",
      "hide",
      "hideOthers",
      "unhide",
      "quit",
    ]);
  });

  it("gives the editing keys their standard commands", () => {
    expect(rolesOf(submenuOf(template(), "Edit"))).toEqual(
      expect.arrayContaining(["undo", "redo", "cut", "copy", "paste", "selectAll"]),
    );
  });

  it("has the standard Window menu", () => {
    expect(template().some((item) => item.role === "windowMenu")).toBe(true);
  });

  it("keeps reloading and the developer tools to development runs", () => {
    const released = rolesOf(submenuOf(template(false), "View"));
    expect(released).not.toContain("reload");
    expect(released).not.toContain("toggleDevTools");
    expect(released).toContain("togglefullscreen");

    expect(rolesOf(submenuOf(template(true), "View"))).toEqual(
      expect.arrayContaining(["reload", "toggleDevTools"]),
    );
  });

  it("opens the project's pages in the browser from Help", () => {
    const openExternal = vi.fn();
    const help = submenuOf(template(false, openExternal), "help");
    for (const item of help) item.click?.(undefined as never, undefined, undefined as never);
    expect(openExternal.mock.calls).toEqual([
      ["https://github.com/ramon427/loam"],
      ["https://github.com/ramon427/loam/issues"],
    ]);
  });
});

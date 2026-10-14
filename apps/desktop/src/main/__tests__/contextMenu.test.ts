import type { ContextMenuParams, MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";

import { contextMenuTemplate } from "../contextMenu";

const editFlags: ContextMenuParams["editFlags"] = {
  canUndo: false,
  canRedo: false,
  canCut: false,
  canCopy: false,
  canPaste: true,
  canDelete: false,
  canSelectAll: true,
  canEditRichly: false,
};

const params = (
  overrides: Partial<Parameters<typeof contextMenuTemplate>[0]> = {},
): Parameters<typeof contextMenuTemplate>[0] => ({
  isEditable: false,
  editFlags,
  selectionText: "",
  linkURL: "",
  mediaType: "none",
  hasImageContents: false,
  ...overrides,
});

const actions = () => ({ copyText: vi.fn(), openExternal: vi.fn(), copyImage: vi.fn() });

/** Each item as its role or label, with "(off)" when disabled. */
const describeItems = (template: MenuItemConstructorOptions[]) =>
  template.map((item) =>
    item.type === "separator"
      ? "---"
      : `${item.role ?? item.label}${item.enabled === false ? " (off)" : ""}`,
  );

describe("contextMenuTemplate", () => {
  it("offers the editing commands a text field allows", () => {
    expect(describeItems(contextMenuTemplate(params({ isEditable: true }), actions()))).toEqual([
      "undo (off)",
      "redo (off)",
      "---",
      "cut (off)",
      "copy (off)",
      "paste",
      "---",
      "selectAll",
    ]);
    const withSelection = contextMenuTemplate(
      params({
        isEditable: true,
        selectionText: "words",
        editFlags: { ...editFlags, canUndo: true, canCut: true, canCopy: true },
      }),
      actions(),
    );
    expect(describeItems(withSelection).filter((item) => item.endsWith("(off)"))).toEqual([
      "redo (off)",
    ]);
  });

  it("offers Copy for text selected outside a field", () => {
    const template = contextMenuTemplate(
      params({ selectionText: "read-only words", editFlags: { ...editFlags, canCopy: true } }),
      actions(),
    );
    expect(describeItems(template)).toEqual(["copy"]);
  });

  it("copies and opens web links, and leaves note links to the app", () => {
    const run = actions();
    const template = contextMenuTemplate(params({ linkURL: "https://example.com/a" }), run);
    expect(describeItems(template)).toEqual(["Copy Link", "Open Link"]);
    (template[0]!.click as () => void)();
    (template[1]!.click as () => void)();
    expect(run.copyText).toHaveBeenCalledWith("https://example.com/a");
    expect(run.openExternal).toHaveBeenCalledWith("https://example.com/a");
    expect(
      contextMenuTemplate(params({ linkURL: "loam-app://app/notes?noteId=1" }), actions()),
    ).toEqual([]);
  });

  it("copies an image, after the field's commands when the image is in one", () => {
    const run = actions();
    const template = contextMenuTemplate(
      params({ isEditable: true, mediaType: "image", hasImageContents: true }),
      run,
    );
    expect(describeItems(template).slice(-2)).toEqual(["---", "Copy Image"]);
    (template.at(-1)!.click as () => void)();
    expect(run.copyImage).toHaveBeenCalled();
  });

  it("is empty where nothing applies, so no menu opens", () => {
    expect(contextMenuTemplate(params(), actions())).toEqual([]);
  });
});

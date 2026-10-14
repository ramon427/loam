import type { ContextMenuParams, MenuItemConstructorOptions } from "electron";

type ContextMenuActions = {
  copyText: (text: string) => void;
  openExternal: (url: string) => void;
  copyImage: () => void;
};

/** Note links and stored images open inside the app, so only web addresses get link actions. */
const isWebUrl = (value: string) => /^https?:\/\//i.test(value);

/**
 * The native menu for a right-click that no menu in the page handled (an in-page menu cancels
 * the event, so Electron never asks): editing for text fields, Copy for selected text, and
 * copying for links and images. Empty when nothing applies, so no menu opens.
 */
export function contextMenuTemplate(
  params: Pick<
    ContextMenuParams,
    "isEditable" | "editFlags" | "selectionText" | "linkURL" | "mediaType" | "hasImageContents"
  >,
  actions: ContextMenuActions,
): MenuItemConstructorOptions[] {
  const { editFlags } = params;
  const sections: MenuItemConstructorOptions[][] = [];
  if (params.isEditable) {
    sections.push(
      [
        { role: "undo", enabled: editFlags.canUndo },
        { role: "redo", enabled: editFlags.canRedo },
      ],
      [
        { role: "cut", enabled: editFlags.canCut },
        { role: "copy", enabled: editFlags.canCopy },
        { role: "paste", enabled: editFlags.canPaste },
      ],
      [{ role: "selectAll", enabled: editFlags.canSelectAll }],
    );
  } else if (params.selectionText.trim() && editFlags.canCopy) {
    sections.push([{ role: "copy" }]);
  }
  if (params.linkURL && isWebUrl(params.linkURL)) {
    const url = params.linkURL;
    sections.push([
      { label: "Copy Link", click: () => actions.copyText(url) },
      { label: "Open Link", click: () => actions.openExternal(url) },
    ]);
  }
  if (params.mediaType === "image" && params.hasImageContents) {
    sections.push([{ label: "Copy Image", click: actions.copyImage }]);
  }
  return sections.flatMap((section, index) =>
    index === 0 ? section : [{ type: "separator" as const }, ...section],
  );
}

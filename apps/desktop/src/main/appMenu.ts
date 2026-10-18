import type { MenuItemConstructorOptions } from "electron";

const HOMEPAGE_URL = "https://github.com/ramon427/loam";

/**
 * The macOS menu bar. The app's own shortcuts (new note, search, settings) live in the window,
 * which sees each key before the menu does; the menu gives the standard ones: About, Hide and
 * Quit, the editing keys (Cmd+C, Cmd+V, Cmd+Z and the rest), and the Window menu. Reloading
 * and the developer tools are only for development runs, since a reload drops unsaved edits.
 * Windows and Linux have no menu bar: the window draws its own title bar.
 */
export function macAppMenuTemplate({
  appName,
  developerTools,
  openExternal,
}: {
  appName: string;
  developerTools: boolean;
  openExternal: (url: string) => void;
}): MenuItemConstructorOptions[] {
  return [
    {
      label: appName,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        ...(developerTools
          ? ([
              { role: "reload" },
              { role: "forceReload" },
              { role: "toggleDevTools" },
              { type: "separator" },
            ] satisfies MenuItemConstructorOptions[])
          : []),
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: `${appName} on GitHub`, click: () => openExternal(HOMEPAGE_URL) },
        { label: "Report a problem", click: () => openExternal(`${HOMEPAGE_URL}/issues`) },
      ],
    },
  ];
}

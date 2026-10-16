import { basename } from "node:path";

import { dialog, type BrowserWindow, type OpenDialogOptions } from "electron";

import { FILE_TAB_KINDS, type FileTabKind } from "@loam/shared/notes/noteModel";

import { IMPORT_FILE_FILTER } from "./import/sources";
import { TAB_FILE_TYPES } from "./tabFiles";

/** The picker's filter for files a tab of `kind` shows. */
const tabFileFilter = (kind: FileTabKind): Electron.FileFilter => ({
  name: TAB_FILE_TYPES[kind].name,
  extensions: TAB_FILE_TYPES[kind].extensions.map((extension) => extension.slice(1)),
});

/**
 * The native pickers the window opens. Paths reach the main process from
 * these, never from the window itself, except files dropped on the window:
 * the files service reads those only when they are a kind of file a tab shows,
 * and an import only once the user confirms them here. Each resolves null (or
 * an empty list, or false) when the user cancels or no window is open.
 */
export const createDialogs = (getWindow: () => BrowserWindow | null) => {
  const open = async (options: OpenDialogOptions) => {
    const window = getWindow();
    if (!window) return [];
    const picked = await dialog.showOpenDialog(window, options);
    return picked.canceled ? [] : picked.filePaths;
  };
  const save = async (options: Electron.SaveDialogOptions) => {
    const window = getWindow();
    if (!window) return null;
    const picked = await dialog.showSaveDialog(window, options);
    return picked.canceled || !picked.filePath ? null : picked.filePath;
  };

  return {
    pickExportFolder: async () =>
      (
        await open({
          title: "Export notes as Markdown",
          buttonLabel: "Export here",
          properties: ["openDirectory", "createDirectory"],
        })
      )[0] ?? null,

    /**
     * One picker for every import. macOS picks a folder or files in one dialog; elsewhere a
     * dialog picks only one or the other, so it takes files and a folder is dropped instead.
     */
    pickImportPaths: () =>
      open({
        title: "Import notes",
        buttonLabel: "Import",
        filters: [IMPORT_FILE_FILTER],
        properties:
          process.platform === "darwin"
            ? ["openFile", "openDirectory", "multiSelections"]
            : ["openFile", "multiSelections"],
      }),

    /** Asks before importing what was dropped on the window. */
    confirmDroppedImport: async (paths: readonly string[]) => {
      const window = getWindow();
      if (!window) return false;
      const named = paths.length === 1 ? `“${basename(paths[0]!)}”` : `${paths.length} items`;
      const { response } = await dialog.showMessageBox(window, {
        type: "question",
        message: `Import ${named}?`,
        detail: "Loam copies the notes in; the files stay where they are.",
        buttons: ["Import", "Cancel"],
        defaultId: 0,
        cancelId: 1,
      });
      return response === 0;
    },

    pickSyncFolder: async () =>
      (
        await open({
          title: "Sync through a folder",
          message: "Pick a folder your cloud drive syncs, such as one in Dropbox or iCloud Drive.",
          buttonLabel: "Sync here",
          properties: ["openDirectory", "createDirectory"],
        })
      )[0] ?? null,

    pickBackupFile: async () =>
      (
        await open({
          title: "Restore notes from a backup",
          buttonLabel: "Restore",
          filters: [{ name: "Loam backup", extensions: ["gz"] }],
          properties: ["openFile"],
        })
      )[0] ?? null,

    pickRecoveryKeyFile: () =>
      save({
        title: "Save your recovery key",
        defaultPath: "Loam recovery key.txt",
        filters: [{ name: "Text", extensions: ["txt"] }],
      }),

    pickTabFile: async (kind: FileTabKind) =>
      (
        await open({
          title: `Add ${TAB_FILE_TYPES[kind].description}`,
          buttonLabel: "Add",
          filters: [tabFileFilter(kind)],
          properties: ["openFile"],
        })
      )[0] ?? null,

    pickFileToOpen: async () =>
      (
        await open({
          title: "Open a file",
          buttonLabel: "Open",
          filters: [
            {
              name: "PDF, Word and Markdown",
              extensions: FILE_TAB_KINDS.flatMap((kind) => tabFileFilter(kind).extensions),
            },
          ],
          properties: ["openFile"],
        })
      )[0] ?? null,

    pickImageCopyFile: (fileName: string, extension: string) =>
      save({
        title: "Save a copy of this image",
        defaultPath: fileName,
        filters: [{ name: "Image", extensions: [extension] }],
      }),
  };
};

export type Dialogs = ReturnType<typeof createDialogs>;

import { dialog, type BrowserWindow, type OpenDialogOptions } from "electron";

import type { BridgeImportSource } from "@loam/shared/bridge/loamBridge";
import { FILE_TAB_KINDS, type FileTabKind } from "@loam/shared/notes/noteModel";

import { IMPORT_SOURCES } from "./import/sources";
import { TAB_FILE_TYPES } from "./tabFiles";

const IMPORT_PICK_PROPERTIES = {
  folder: ["openDirectory"],
  files: ["openFile", "multiSelections"],
  archive: ["openFile"],
} satisfies Record<string, OpenDialogOptions["properties"]>;

/** The picker's filter for files a tab of `kind` shows. */
const tabFileFilter = (kind: FileTabKind): Electron.FileFilter => ({
  name: TAB_FILE_TYPES[kind].name,
  extensions: TAB_FILE_TYPES[kind].extensions.map((extension) => extension.slice(1)),
});

/**
 * The native pickers the window opens. Paths reach the main process from
 * these, never from the window itself, except files dropped on the window,
 * which the files service reads only when they are a kind of file a tab
 * shows. Each resolves null (or an empty list) when the user cancels or no
 * window is open.
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

    pickImportPaths: (source: BridgeImportSource) =>
      open({
        ...IMPORT_SOURCES[source].dialog,
        buttonLabel: "Import",
        properties: IMPORT_PICK_PROPERTIES[IMPORT_SOURCES[source].pick],
      }),

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

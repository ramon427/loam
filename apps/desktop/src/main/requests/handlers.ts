import type {
  LoamBridgeMethod,
  LoamBridgeParams,
  LoamBridgeResult,
} from "@loam/shared/bridge/loamBridge";
import { StoreError } from "@loam/storage/storeError";

import type { AiService } from "../ai/service";
import type { Customizations } from "../customizations";
import type { Dialogs } from "../dialogs";
import type { EncryptionManager } from "../encryption/encryption";
import type { LibraryGate } from "../libraryGate";
import type { McpService } from "../mcp/service";
import type { Plugins } from "../plugins/plugins";
import type { UpdateService } from "../updates";
import type { MainWindow } from "../window";
import type { WorkspaceRequests } from "../workspaceRequests";
import type { Caller } from "./dispatch";

/** What requests run against. */
export type AppServices = {
  info: { version: string; dataDirectory: string };
  window: MainWindow;
  dialogs: Dialogs;
  customizations: Customizations;
  encryption: EncryptionManager;
  /** The open library, and what may be asked while it is locked. */
  gate: LibraryGate;
  mcp: McpService;
  ai: AiService;
  plugins: Plugins;
  updates: UpdateService;
  workspace: WorkspaceRequests;
  /** The files the system asked the app to open since the window last took them. */
  takeWaitingFiles: () => string[];
  /** Opens the data folder in the file manager. */
  revealDataDirectory: () => Promise<void>;
  /** Closes the window, then installs the downloaded update. */
  restartToUpdate: () => void;
};

export type Handlers = {
  [M in LoamBridgeMethod]: (
    params: LoamBridgeParams<M>,
    caller: Caller,
  ) => Promise<LoamBridgeResult<M>>;
};

/**
 * What each request does, given params its schema already checked (see
 * BRIDGE_PARAMS). Each calls one service, where the work lives; one that
 * needs a path the user picks shows the dialog first, then calls the service.
 * `caller` tells the store whether a write came from outside the window, so
 * the window is told about it.
 */
export const createHandlers = (app: AppServices): Handlers => {
  const library = () => app.gate.library();
  const by = (caller: Caller) => ({ external: caller === "ai" });

  return {
    "notes.library": async () => library().store.getLibrary(),
    "notes.get": async ({ noteId }) => library().store.getNote(noteId),
    "notes.create": async ({ note }, caller) => library().store.createNote(note, by(caller)),
    "notes.save": async ({ noteId, patch, baseUpdatedAt }, caller) =>
      library().store.saveNote(noteId, patch, baseUpdatedAt, by(caller)),
    "notes.delete": async ({ noteId }, caller) => library().store.deleteNote(noteId, by(caller)),
    "notes.restore": async ({ note }, caller) => library().store.restoreNote(note, by(caller)),
    "notes.trash": async () => library().store.getTrash(),
    "notes.restoreTrash": async ({ noteId }, caller) =>
      library().store.restoreTrashedNote(noteId, by(caller)),
    "notes.deleteForever": async ({ noteId }) => {
      await library().store.deleteTrashedNote(noteId);
      return null;
    },
    "notes.saveLayout": async ({ layout }, caller) =>
      library().store.saveLayout(layout, by(caller)),
    "notes.backlinks": async ({ noteId }) => library().store.getBacklinks(noteId),
    "notes.search": async ({ query, limit = 20, offset = 0 }) =>
      library().store.searchNotes(query, limit, offset),
    "notes.history": async ({ noteId }) => library().store.getNoteHistory(noteId),
    "notes.version": async ({ noteId, versionId }) =>
      library().store.getNoteVersion(noteId, versionId),
    "notes.restoreVersion": async ({ noteId, versionId }, caller) => {
      await library().store.restoreNoteVersion(noteId, versionId, by(caller));
      return null;
    },

    "media.saveImage": async ({ bytes }) => library().media.saveImage(bytes),
    "media.saveImageAs": async ({ reference }) =>
      library().media.saveImageCopy(reference, app.dialogs.pickImageCopyFile),
    "media.copyImage": async ({ reference }) => {
      const image = await library().media.readImageFile(reference);
      if (!app.window.copyImage(image.bytes))
        throw new StoreError("This image can't be copied.", "MEDIA_TYPE_UNSUPPORTED", 415);
      return null;
    },

    "files.import": async ({ kind }) => {
      const path = await app.dialogs.pickTabFile(kind);
      return path ? library().files.importPath(kind, path) : null;
    },
    "files.pick": async () => {
      const path = await app.dialogs.pickFileToOpen();
      return path ? library().files.link(path) : null;
    },
    "files.link": async ({ path }) => library().files.link(path),
    "files.copyIn": async ({ kind, file }) => library().files.copyIn(kind, file),
    "files.read": async ({ kind, file }) => library().files.read(kind, file),
    "files.writeMarkdown": async ({ file, text }) => {
      await library().files.writeMarkdown(file, text);
      return null;
    },
    "files.openExternally": async ({ kind, file }) => library().files.openExternally(kind, file),
    "files.takeBackCopy": async ({ kind, path, name }) =>
      library().files.takeBackCopy(kind, path, name),
    "files.watch": async ({ kind, path }) => {
      library().files.watch(kind, path);
      return null;
    },
    "files.unwatch": async ({ path }) => {
      library().files.unwatch(path);
      return null;
    },
    "files.takeOpened": async () => library().files.linkOpened(app.takeWaitingFiles()),

    "app.info": async () => ({
      version: app.info.version,
      storageAdapter: library().store.adapterName,
      dataDirectory: app.info.dataDirectory,
    }),
    "app.openDataDirectory": async () => {
      await app.revealDataDirectory();
      return null;
    },
    "app.setTheme": async ({ theme, colors }) => {
      app.window.setTheme(theme, colors);
      return null;
    },
    "app.automationResult": async ({ requestId, result }) => {
      app.workspace.respond(requestId, result);
      return null;
    },
    "customizations.list": async () => app.customizations.list(),
    "customizations.reveal": async ({ kind }) => {
      await app.customizations.reveal(kind);
      return null;
    },

    "plugins.list": async () => app.plugins.list(),
    "plugins.setRestricted": async ({ restrictedMode }) => {
      await app.plugins.setRestricted(restrictedMode);
      return null;
    },
    "plugins.setEnabled": async ({ id, enabled, granted }) => {
      await app.plugins.setEnabled(id, enabled, granted);
      return null;
    },
    "plugins.setSetting": async ({ id, key, value }) => {
      await app.plugins.setSetting(id, key, value);
      return null;
    },
    "plugins.source": async ({ id }) => app.plugins.source(id),
    "plugins.reveal": async () => {
      await app.plugins.reveal();
      return null;
    },
    "plugins.call": async ({ id, op, params }) => app.plugins.call(id, op, params),
    "plugins.fetch": async ({ id, ...request }) => app.plugins.fetch(id, request),
    "plugins.storeGet": async ({ id, key }) => app.plugins.storeGet(id, key),
    "plugins.storeSet": async ({ id, key, value }) => app.plugins.storeSet(id, key, value),

    "mcp.status": async () => app.mcp.status(),
    "mcp.configure": async (settings) => app.mcp.configure(settings),
    "mcp.connection": async () => app.mcp.connection(),
    "mcp.rotateToken": async () => app.mcp.rotateToken(),

    "ai.status": async () => app.ai.status(),
    "ai.configure": async (update) => app.ai.configure(update),
    "ai.setKey": async ({ provider, key }) => app.ai.setKey(provider, key),
    "ai.transcribe": async ({ audio, mimeType }) => app.ai.transcribe(audio, mimeType),
    "ai.threads": async () => app.ai.list(),
    "ai.thread": async ({ threadId }) => app.ai.thread(threadId),
    "ai.send": async (params) => app.ai.send(params),
    "ai.attachment": async ({ threadId, attachmentId }) =>
      app.ai.attachment(threadId, attachmentId),
    "ai.stop": async ({ threadId }) => {
      app.ai.stop(threadId);
      return null;
    },
    "ai.respond": async ({ threadId, approvalId, decision }) => {
      app.ai.respond(threadId, approvalId, decision);
      return null;
    },
    "ai.undo": async ({ threadId, actionIds }) => {
      await app.ai.undo(threadId, actionIds);
      return null;
    },
    "ai.setMode": async ({ threadId, mode }) => {
      await app.ai.setMode(threadId, mode);
      return null;
    },
    "ai.renameThread": async ({ threadId, title }) => {
      await app.ai.rename(threadId, title);
      return null;
    },
    "ai.deleteThread": async ({ threadId }) => {
      await app.ai.remove(threadId);
      return null;
    },

    "export.markdown": async ({ scope }) => {
      const { exporter } = library();
      const parentDirectory = await app.dialogs.pickExportFolder();
      if (!parentDirectory) return { status: "canceled" };
      return { status: "done", ...(await exporter.run(scope, parentDirectory)) };
    },
    "export.reveal": async () => {
      await library().exporter.reveal();
      return null;
    },

    "import.pick": async () => {
      const { importer } = library();
      return importer.pick("auto", await app.dialogs.pickImportPaths(), "window");
    },
    "import.pickDropped": async ({ paths }) => {
      const { importer } = library();
      // Paths from the window are read only after the user confirms them where it can't reach.
      if (!(await app.dialogs.confirmDroppedImport(paths))) return { status: "canceled" };
      return importer.pick("auto", paths, "window");
    },
    "import.images": async ({ sessionId, requests }) =>
      library().importer.images(sessionId, requests),
    "import.write": async ({ sessionId, notes }) => library().importer.write(sessionId, notes),
    "import.finish": async ({ sessionId }) => library().importer.finish(sessionId),

    "backups.list": async () => {
      const { backups } = library();
      return {
        directory: backups.directory,
        backups: await backups.list(),
        lastError: backups.lastError(),
      };
    },
    "backups.create": async () => library().backups.create("manual"),
    "backups.restore": async ({ backupId, secret }) =>
      library().backups.restore({ id: backupId }, secret),
    "backups.restoreFile": async ({ secret }) =>
      library().backups.restorePickedFile(app.dialogs.pickBackupFile, secret),
    "backups.openFolder": async () => {
      await library().backups.reveal();
      return null;
    },

    "sync.status": async () => library().sync.status(),
    "sync.chooseFolder": async () => {
      const { sync } = library();
      const folder = await app.dialogs.pickSyncFolder();
      if (!folder) return { status: "canceled" };
      return { status: "chosen", sync: await sync.useFolder(folder) };
    },
    "sync.now": async () => library().sync.syncNow(),
    "sync.turnOff": async () => library().sync.turnOff(),
    "sync.unlockFolder": async ({ secret }) => app.gate.unlockSyncFolder(secret),

    "security.status": async () => app.gate.securityStatus(),
    "security.unlock": async ({ passphrase }) => app.gate.unlock(passphrase),
    "security.resetPassphrase": async ({ recoveryKey, passphrase }) =>
      app.gate.resetPassphrase(recoveryKey, passphrase),
    "security.newRecoveryKey": async () => ({ recoveryKey: app.encryption.newRecoveryKey() }),
    "security.saveRecoveryKey": async () => {
      if (!app.encryption.pendingRecoveryKey()) return { status: "canceled" };
      const path = await app.dialogs.pickRecoveryKeyFile();
      if (!path) return { status: "canceled" };
      // The save dialog has already asked before replacing a file.
      await app.encryption.saveRecoveryKey(path, { replace: true });
      return { status: "saved" };
    },
    "security.enable": async ({ passphrase, recoveryKey }) =>
      app.gate.enableEncryption(passphrase, recoveryKey),
    "security.changePassphrase": async ({ current, next }) => {
      await app.encryption.changePassphrase(library().parts, current, next);
      return null;
    },
    "security.disable": async ({ passphrase }) => app.gate.disableEncryption(passphrase),

    "updates.status": async () => app.updates.status(),
    "updates.check": async () => app.updates.check(),
    "updates.install": async () => {
      app.restartToUpdate();
      return null;
    },
  };
};

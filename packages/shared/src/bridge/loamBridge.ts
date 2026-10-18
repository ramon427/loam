import type { BridgePluginFetch, BridgePlugins, PluginOp } from "../plugins/pluginApi";
import type { PluginSettingValue } from "../plugins/pluginManifest";
import type { ThemeManifest } from "../themes/themeSchema";
import type {
  AiApprovalDecision,
  AiChatConfigure,
  AiChatContext,
  AiChatEvent,
  AiChatStatus,
  AiAccessMode,
  AiKeyProviderId,
  AiThread,
  AiThreadSummary,
  AiAttachmentUpload,
} from "../ai/aiChat";
import type {
  FileTabKind,
  NewNote,
  NoteBacklinks,
  NoteContentSearchResponse,
  NoteDocument,
  NoteFile,
  NoteGraph,
  NoteHistory,
  NotePatch,
  NotesBootstrap,
  NotesChange,
  NotesLayout,
  NoteTab,
  NoteTable,
  NoteTrashEntry,
  NoteVersion,
  NoteVideo,
  SavedNote,
} from "../notes/noteModel";

/**
 * The bridge between the window and the main process. The window calls
 * `window.loam.invoke(method, params)`; the main process checks the params and
 * answers with a result. AI clients reach the same operations through MCP.
 */

/** Every bridge call settles to a result; failures carry a machine-readable code. */
export type BridgeResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string; status: number } };

type BridgeImageUpload = { path: string; url: string };

type BridgeAppInfo = {
  version: string;
  storageAdapter: string;
  dataDirectory: string;
};

/** What a Markdown export covers: the whole library or one note. */
export type BridgeExportScope = { kind: "all" } | { kind: "note"; noteId: string };

/** A finished Markdown export: the folder it made and what it wrote there. */
export type BridgeExportDone = {
  directory: string;
  noteCount: number;
  fileCount: number;
  missingImages: number;
};

type BridgeExportResult = { status: "canceled" } | ({ status: "done" } & BridgeExportDone);

/** Where an import reads from; each source picks a folder or a file. */
export type BridgeImportSource = "markdown" | "evernote" | "notion" | "html";

/** A text file read for an import. Paths are relative to what was picked and use `/`. */
export type BridgeImportFile = { path: string; text: string };

/** Something an import left out, with the short reason its summary shows. */
export type BridgeImportSkip = { path: string; reason: string };

export type BridgeImportPick =
  | { status: "canceled" }
  | {
      status: "picked";
      /** Which app's export it is: as asked, or as told from what was picked. */
      source: BridgeImportSource;
      sessionId: string;
      /** The picked folder or file name, for messages. */
      name: string;
      files: BridgeImportFile[];
      skipped: BridgeImportSkip[];
    };

/** An image a note refers to: the note's path and the reference as written in it. */
export type BridgeImportImageRequest = { fromPath: string; reference: string };

export type BridgeImportImageResult = { url: string } | { skipped: string };

/** A note to create, already in Loam's block format. `folder` is a folder name. */
export type BridgeImportNote = {
  id: string;
  title: string;
  folder: string | null;
  tabs: NoteTab[];
  blocksByTab: Record<string, unknown[]>;
  graphsByTab?: Record<string, NoteGraph>;
  tablesByTab?: Record<string, NoteTable>;
  activeTabId: string;
  video?: NoteVideo;
};

export type BridgeImportResult = { noteCount: number; folderCount: number };

/**
 * Daily and manual backups follow the schedule; safety backups, named for
 * what they come before, are taken before risky changes.
 */
export const BACKUP_KINDS = [
  "auto",
  "manual",
  "before-restore",
  "before-import",
  "before-encryption",
] as const;

export type BridgeBackupKind = (typeof BACKUP_KINDS)[number];

export type BridgeBackup = {
  /** The backup's file name, which is also how it is referred to. */
  id: string;
  createdAt: number;
  kind: BridgeBackupKind;
  sizeBytes: number;
};

export type BridgeBackupList = {
  directory: string;
  /** Newest first. */
  backups: BridgeBackup[];
  /** Why the last backup failed, until one succeeds. */
  lastError: string | null;
};

/** After a restore the app restarts on its own. */
type BridgeBackupRestore = { createdAt: number };

/** Where sync stands. `folder` is null while sync is off. */
export type BridgeSyncStatus = {
  folder: string | null;
  state: "off" | "syncing" | "synced" | "error";
  lastSyncedAt: number | null;
  /** Why the last sync failed; it is retried on its own. */
  error: string | null;
  /** Changes made here that other devices don't have yet. */
  unpublished: number;
  /** The folder's notes are encrypted with a key this computer doesn't use yet. */
  needsPassphrase: boolean;
};

/**
 * Whether notes are encrypted on this computer. "locked" until the passphrase
 * is entered at launch; nothing else can be read until then.
 */
export type BridgeSecurityStatus = { state: "off" | "locked" | "on" };

/**
 * Where app updates stand. Updates download in the background; "ready" means
 * one is downloaded and installs on restart. "available" means a newer version
 * is out that this copy can't install itself (the unsigned macOS app), so the
 * user downloads it from its release page. "unavailable" when this build
 * doesn't look for updates, such as a development run.
 */
export type BridgeUpdateStatus = {
  state: "unavailable" | "idle" | "checking" | "available" | "downloading" | "ready" | "error";
  /** The version available, downloading or ready to install. */
  version: string | null;
  /** Download progress, 0 to 100, while downloading. */
  progress: number | null;
  lastCheckedAt: number | null;
  /** Why the last check or download failed; it is retried on its own. */
  error: string | null;
  /** What changed in the releases since this version, newest first. */
  releaseNotes: BridgeReleaseNote[];
  /** Further releases left out of `releaseNotes`. */
  omittedReleaseCount: number;
};

export type BridgeReleaseNote = {
  version: string;
  /** The first few changes, as plain text. */
  items: string[];
  /** How many changes the release lists in all. */
  totalItems: number;
};

/** Explicit renderer operations; no arbitrary scripts or preference keys. */
export type BridgeAutomationCommand =
  | { action: "status" | "flush" }
  | { action: "openNote"; noteId: string | null; tabId?: string }
  | { action: "setTheme"; theme?: "light" | "dark" | "system"; themeId?: string }
  | { action: "graphTemplates"; templateId?: string }
  | { action: "layoutGraph"; graph: NoteGraph; mode: "tidy" | "grid" }
  | { action: "video"; command: "open" | "play" | "pause" | "seek"; seconds?: number }
  | { action: "parseMarkdown" | "parseHtml"; text: string }
  | {
      action: "convertImport";
      source: BridgeImportSource;
      sessionId: string;
      files: BridgeImportFile[];
    }
  | { action: "exportGraph"; graph: NoteGraph; format: "svg" | "png" };

export type BridgeMcpStatus = {
  enabled: boolean;
  running: boolean;
  port: number;
  url: string | null;
  error: string | null;
};

/** Returned only to the trusted settings window, never in MCP discovery. */
export type BridgeMcpConnection = { config: string; stdioConfig: string; configPath: string };

/** The folders in the data folder that hold theme files and CSS snippets. */
export type BridgeCustomizationKind = "themes" | "snippets";

/** A theme file, as read: the theme, or why it can't be used. */
export type BridgeThemeFile = { file: string } & (
  { ok: true; theme: ThemeManifest } | { ok: false; error: string }
);

export type BridgeCustomizations = {
  themes: BridgeThemeFile[];
  /** Each snippet's stylesheet as written; the window sanitizes it before laying it down. */
  snippets: { file: string; css: string }[];
};

/** One kind of request: the params the caller sends and the data it gets back. */
type Request<Params, Result> = { params: Params; result: Result };
type NoParams = Record<string, never>;

/** Requests the window may send to the main process. */
type LoamBridgeRequests = {
  /** Every folder and a summary of every note, in library order. */
  "notes.library": Request<NoParams, NotesBootstrap>;
  "notes.get": Request<{ noteId: string }, NoteDocument>;
  /** Creates a note at the end of its folder. */
  "notes.create": Request<{ note: NewNote }, NoteDocument>;
  /** `baseUpdatedAt` is the version the edits were made to (see NotesStore.saveNote). */
  "notes.save": Request<{ noteId: string; patch: NotePatch; baseUpdatedAt?: string }, SavedNote>;
  /** Deletes a note and returns it, so it can be put back. */
  "notes.delete": Request<{ noteId: string }, NoteDocument>;
  /** Puts a deleted note back at its folder and position. */
  "notes.restore": Request<{ note: NoteDocument }, NoteDocument>;
  "notes.trash": Request<NoParams, NoteTrashEntry[]>;
  "notes.restoreTrash": Request<{ noteId: string }, NoteDocument>;
  "notes.deleteForever": Request<{ noteId: string }, null>;
  /** Saves every folder and the order of the notes, returning the library as stored. */
  "notes.saveLayout": Request<{ layout: NotesLayout }, NotesBootstrap>;
  "notes.backlinks": Request<{ noteId: string }, NoteBacklinks>;
  "notes.search": Request<
    { query: string; limit?: number; offset?: number },
    NoteContentSearchResponse
  >;
  /** A note's saved versions, newest first. */
  "notes.history": Request<{ noteId: string }, NoteHistory>;
  /** One saved version's full content, for a read-only preview. */
  "notes.version": Request<{ noteId: string; versionId: string }, NoteVersion>;
  /** Makes a saved version the note's content again; what it replaces becomes a version. */
  "notes.restoreVersion": Request<{ noteId: string; versionId: string }, null>;
  /**
   * Copies an image into the local media folder; its type is read from its
   * bytes. Notes store the returned `path`; `url` is the `loam-media://` address
   * that displays it.
   */
  "media.saveImage": Request<{ bytes: Uint8Array }, BridgeImageUpload>;
  /** Asks where to save a copy of a note's image; resolves "canceled" if nowhere is picked. */
  "media.saveImageAs": Request<{ reference: string }, { status: "canceled" | "saved" }>;
  /** Puts a note's image on the system clipboard; fails for types it can't hold (GIF, WebP, AVIF). */
  "media.copyImage": Request<{ reference: string }, null>;
  /**
   * Asks for a file for a tab of `kind` and keeps it in the library: a PDF or
   * Word document copied into the media folder, Markdown as the note's text.
   * Resolves null if none is picked.
   */
  "files.import": Request<{ kind: FileTabKind }, NoteFile | null>;
  /** Asks for a PDF, Word or Markdown file to open where it is; null if none is picked. */
  "files.pick": Request<NoParams, BridgeLinkedFile | null>;
  /** A link to the file at `path` (dropped on the window), and the kind of tab that shows it. */
  "files.link": Request<{ path: string }, BridgeLinkedFile>;
  /** A linked file copied into the library, as the tab keeps it from then on. */
  "files.copyIn": Request<{ kind: FileTabKind; file: NoteFile }, NoteFile>;
  /** A tab's file as bytes. */
  "files.read": Request<{ kind: FileTabKind; file: NoteFile }, Uint8Array>;
  /** Saves a linked Markdown file's text where it is. */
  "files.writeMarkdown": Request<{ file: NoteFile; text: string }, null>;
  /**
   * Opens a tab's file in the app the system opens it with: a linked file
   * where it is, a library file as a copy. Resolves the path it opened.
   */
  "files.openExternally": Request<{ kind: FileTabKind; file: NoteFile }, { path: string }>;
  /** A copy `files.openExternally` opened, read back after another app edited it. */
  "files.takeBackCopy": Request<{ kind: FileTabKind; path: string; name: string }, NoteFile>;
  /** Sends `files.changed` when the file at `path` changes, until `files.unwatch`. */
  "files.watch": Request<{ kind: FileTabKind; path: string }, null>;
  "files.unwatch": Request<{ path: string }, null>;
  /** The files the system asked Loam to open (such as with "Open with"), linked; each once. */
  "files.takeOpened": Request<NoParams, BridgeLinkedFile[]>;
  /** Version, storage backend and data folder of the running app. */
  "app.info": Request<NoParams, BridgeAppInfo>;
  /** Opens the data folder in the system file manager. */
  "app.openDataDirectory": Request<NoParams, null>;
  /**
   * Keeps the native window controls in the window's theme. `glass` lets the desktop show
   * through the window, frosted, where the platform can draw it (macOS and Windows 11).
   */
  "app.setTheme": Request<
    {
      theme: "light" | "dark";
      colors?: { color: string; symbolColor: string };
      glass?: boolean;
    },
    null
  >;
  /** The theme files and CSS snippets in the data folder. */
  "customizations.list": Request<NoParams, BridgeCustomizations>;
  /** Opens the themes or snippets folder in the file manager. */
  "customizations.reveal": Request<{ kind: BridgeCustomizationKind }, null>;
  /** The plugin folders, what each may do, and whether restricted mode holds them all back. */
  "plugins.list": Request<NoParams, BridgePlugins>;
  "plugins.setRestricted": Request<{ restrictedMode: boolean }, null>;
  /** Switches a plugin on or off; `granted` replaces its granted permissions. */
  "plugins.setEnabled": Request<{ id: string; enabled: boolean; granted?: string[] }, null>;
  "plugins.setSetting": Request<{ id: string; key: string; value: PluginSettingValue }, null>;
  /** A running plugin's module, for its worker. */
  "plugins.source": Request<{ id: string }, { code: string }>;
  /** Opens the plugins folder in the file manager. */
  "plugins.reveal": Request<NoParams, null>;
  /** One of a running plugin's note operations, checked against what it was granted. */
  "plugins.call": Request<{ id: string; op: PluginOp; params: unknown }, unknown>;
  /** An https request to a host the plugin was granted. */
  "plugins.fetch": Request<
    { id: string; url: string; method?: string; headers?: Record<string, string>; body?: string },
    BridgePluginFetch
  >;
  /** A value the plugin stored, kept across sessions; null when there is none. */
  "plugins.storeGet": Request<{ id: string; key: string }, unknown>;
  /** Stores a value for the plugin; null removes it. */
  "plugins.storeSet": Request<{ id: string; key: string; value: unknown }, null>;
  /** The window's answer to an `app.automation` event. */
  "app.automationResult": Request<{ requestId: string; result: BridgeResult<unknown> }, null>;
  "mcp.status": Request<NoParams, BridgeMcpStatus>;
  "mcp.configure": Request<{ enabled: boolean; port?: number }, BridgeMcpStatus>;
  "mcp.connection": Request<NoParams, BridgeMcpConnection>;
  "mcp.rotateToken": Request<NoParams, BridgeMcpConnection>;
  /** The side chat's settings and which providers are ready; never returns a key. */
  "ai.status": Request<NoParams, AiChatStatus>;
  "ai.configure": Request<AiChatConfigure, AiChatStatus>;
  /** Saves a provider's API key, encrypted by the operating system; null removes it. */
  "ai.setKey": Request<{ provider: AiKeyProviderId; key: string | null }, AiChatStatus>;
  /** Writes recorded speech as text, with the saved OpenAI key. */
  "ai.transcribe": Request<{ audio: Uint8Array; mimeType: string }, { text: string }>;
  /** Saved chats, most recent first. */
  "ai.threads": Request<NoParams, AiThreadSummary[]>;
  "ai.thread": Request<{ threadId: string }, AiThread>;
  /**
   * Sends a message and starts the assistant's turn; replies arrive as
   * `ai.event`. A null `threadId` starts a new chat.
   */
  "ai.send": Request<
    {
      threadId: string | null;
      text: string;
      context: AiChatContext | null;
      mode: AiAccessMode;
      /** Files sent with the message; a message may be only files. */
      attachments?: AiAttachmentUpload[];
    },
    { threadId: string }
  >;
  /** A file sent in a chat, as it was attached, to show it again. */
  "ai.attachment": Request<{ threadId: string; attachmentId: string }, Uint8Array>;
  /** Stops the running turn; what it already changed stays, and can be undone. */
  "ai.stop": Request<{ threadId: string }, null>;
  /** Answers an approval the assistant is waiting on. */
  "ai.respond": Request<
    { threadId: string; approvalId: string; decision: AiApprovalDecision },
    null
  >;
  /** Undoes the assistant's changes, newest first. */
  "ai.undo": Request<{ threadId: string; actionIds: string[] }, null>;
  /** Changes how much the assistant may do in a chat, from its next step on. */
  "ai.setMode": Request<{ threadId: string; mode: AiAccessMode }, null>;
  "ai.renameThread": Request<{ threadId: string; title: string }, null>;
  "ai.deleteThread": Request<{ threadId: string }, null>;
  /** Asks for a folder and writes the notes there as Markdown; "canceled" if none is picked. */
  "export.markdown": Request<{ scope: BridgeExportScope }, BridgeExportResult>;
  /** Opens the folder the last export wrote. */
  "export.reveal": Request<NoParams, null>;
  /** Asks for the folder or files to import and reads their notes. */
  /** Opens the one import picker; the main process tells the source from what is picked. */
  "import.pick": Request<NoParams, BridgeImportPick>;
  /** Imports what was dropped on the window, once the user confirms it in a system dialog. */
  "import.pickDropped": Request<{ paths: string[] }, BridgeImportPick>;
  /** Copies the images imported notes refer to; results follow the request order. */
  "import.images": Request<
    { sessionId: string; requests: BridgeImportImageRequest[] },
    BridgeImportImageResult[]
  >;
  /** Creates a batch of imported notes. */
  "import.write": Request<{ sessionId: string; notes: BridgeImportNote[] }, { written: number }>;
  /** Places every written note into its folder and ends the import. */
  "import.finish": Request<{ sessionId: string }, BridgeImportResult>;
  /** Backups in the backups folder, newest first, and why the last one failed, if it did. */
  "backups.list": Request<NoParams, BridgeBackupList>;
  /** Backs up the whole library now. */
  "backups.create": Request<NoParams, BridgeBackup>;
  /**
   * Replaces every note with a backup's; the app restarts afterwards. `secret`
   * unlocks a backup encrypted with another passphrase (or its recovery key).
   */
  "backups.restore": Request<{ backupId: string; secret?: string }, BridgeBackupRestore>;
  /** Asks for a backup file; with `secret`, restores the encrypted file picked last instead. */
  "backups.restoreFile": Request<
    { secret?: string },
    { status: "canceled" } | ({ status: "restored" } & BridgeBackupRestore)
  >;
  /** Opens the backups folder in the system file manager. */
  "backups.openFolder": Request<NoParams, null>;
  "sync.status": Request<NoParams, BridgeSyncStatus>;
  /** Asks for a folder to sync through and starts syncing. */
  "sync.chooseFolder": Request<
    NoParams,
    { status: "canceled" } | { status: "chosen"; sync: BridgeSyncStatus }
  >;
  /** Syncs now instead of at the next scheduled time. */
  "sync.now": Request<NoParams, BridgeSyncStatus>;
  /** Stops syncing. Notes stay on this computer and in the sync folder. */
  "sync.turnOff": Request<NoParams, BridgeSyncStatus>;
  /** Uses the key of the sync folder's encrypted notes, unlocked by its passphrase or recovery key. */
  "sync.unlockFolder": Request<{ secret: string }, BridgeSyncStatus>;
  "security.status": Request<NoParams, BridgeSecurityStatus>;
  /** Opens encrypted notes at launch. */
  "security.unlock": Request<{ passphrase: string }, BridgeSecurityStatus>;
  /** Unlocks with the recovery key and replaces the forgotten passphrase. */
  "security.resetPassphrase": Request<
    { recoveryKey: string; passphrase: string },
    BridgeSecurityStatus
  >;
  /** A new recovery key for turning encryption on; shown to be saved before anything is encrypted. */
  "security.newRecoveryKey": Request<NoParams, { recoveryKey: string }>;
  /** Asks where to save that recovery key. */
  "security.saveRecoveryKey": Request<NoParams, { status: "canceled" | "saved" }>;
  /** `recoveryKey` is the one shown, so only a key the user saw can lock the notes. */
  "security.enable": Request<{ passphrase: string; recoveryKey: string }, BridgeSecurityStatus>;
  "security.changePassphrase": Request<{ current: string; next: string }, null>;
  /** Decrypts every note; turns sync off. */
  "security.disable": Request<{ passphrase: string }, BridgeSecurityStatus>;
  "updates.status": Request<NoParams, BridgeUpdateStatus>;
  /** Checks for an update now; one that is found downloads in the background where it can install. */
  "updates.check": Request<NoParams, BridgeUpdateStatus>;
  /** Closes the window and restarts into the downloaded update. */
  "updates.install": Request<NoParams, null>;
};

export type LoamBridgeMethod = keyof LoamBridgeRequests;
export type LoamBridgeParams<M extends LoamBridgeMethod> = LoamBridgeRequests[M]["params"];
export type LoamBridgeResult<M extends LoamBridgeMethod> = LoamBridgeRequests[M]["result"];

/** Naming every method in a record makes the compiler reject a missing or unknown one. */
const METHODS: Record<LoamBridgeMethod, true> = {
  "notes.library": true,
  "notes.get": true,
  "notes.create": true,
  "notes.save": true,
  "notes.delete": true,
  "notes.restore": true,
  "notes.trash": true,
  "notes.restoreTrash": true,
  "notes.deleteForever": true,
  "notes.saveLayout": true,
  "notes.backlinks": true,
  "notes.search": true,
  "notes.history": true,
  "notes.version": true,
  "notes.restoreVersion": true,
  "media.saveImage": true,
  "media.saveImageAs": true,
  "media.copyImage": true,
  "files.import": true,
  "files.pick": true,
  "files.link": true,
  "files.copyIn": true,
  "files.read": true,
  "files.writeMarkdown": true,
  "files.openExternally": true,
  "files.takeBackCopy": true,
  "files.watch": true,
  "files.unwatch": true,
  "files.takeOpened": true,
  "app.info": true,
  "app.openDataDirectory": true,
  "app.setTheme": true,
  "app.automationResult": true,
  "customizations.list": true,
  "customizations.reveal": true,
  "plugins.list": true,
  "plugins.setRestricted": true,
  "plugins.setEnabled": true,
  "plugins.setSetting": true,
  "plugins.source": true,
  "plugins.reveal": true,
  "plugins.call": true,
  "plugins.fetch": true,
  "plugins.storeGet": true,
  "plugins.storeSet": true,
  "mcp.status": true,
  "mcp.configure": true,
  "mcp.connection": true,
  "mcp.rotateToken": true,
  "ai.status": true,
  "ai.configure": true,
  "ai.setKey": true,
  "ai.transcribe": true,
  "ai.threads": true,
  "ai.thread": true,
  "ai.send": true,
  "ai.attachment": true,
  "ai.stop": true,
  "ai.respond": true,
  "ai.undo": true,
  "ai.setMode": true,
  "ai.renameThread": true,
  "ai.deleteThread": true,
  "export.markdown": true,
  "export.reveal": true,
  "import.pick": true,
  "import.pickDropped": true,
  "import.images": true,
  "import.write": true,
  "import.finish": true,
  "backups.list": true,
  "backups.create": true,
  "backups.restore": true,
  "backups.restoreFile": true,
  "backups.openFolder": true,
  "sync.status": true,
  "sync.chooseFolder": true,
  "sync.now": true,
  "sync.turnOff": true,
  "sync.unlockFolder": true,
  "security.status": true,
  "security.unlock": true,
  "security.resetPassphrase": true,
  "security.newRecoveryKey": true,
  "security.saveRecoveryKey": true,
  "security.enable": true,
  "security.changePassphrase": true,
  "security.disable": true,
  "updates.status": true,
  "updates.check": true,
  "updates.install": true,
};

export const LOAM_BRIDGE_METHODS = Object.keys(METHODS) as LoamBridgeMethod[];

export const LOAM_BRIDGE_CHANNEL_PREFIX = "loam:";

/** A file opened where it is, and the kind of tab that shows it. */
export type BridgeLinkedFile = { kind: FileTabKind; file: NoteFile };

/** Events the main process sends the window. */
export type LoamBridgeEvents = {
  /** Notes changed by sync or an AI client; the window's own changes aren't echoed. */
  "notes.changed": NotesChange;
  "sync.status": BridgeSyncStatus;
  "updates.status": BridgeUpdateStatus;
  "security.status": BridgeSecurityStatus;
  /** A request from an AI client that only the window can carry out. */
  "app.automation": { requestId: string; command: BridgeAutomationCommand };
  /** The side chat's settings changed. */
  "ai.status": AiChatStatus;
  /** Replies, actions and approvals as the side chat's turns run. */
  "ai.event": AiChatEvent;
  /** A theme file or CSS snippet was added, changed or removed. */
  "customizations.changed": null;
  /** A plugin's files, or what the user allowed plugins, changed. */
  "plugins.changed": null;
  /** A file a tab watches changed on disk. */
  "files.changed": { path: string };
  /** The system asked Loam to open files, such as with "Open with"; `files.takeOpened` has them. */
  "files.waiting": null;
};

export type LoamBridgeEvent = keyof LoamBridgeEvents;

const EVENTS: Record<LoamBridgeEvent, true> = {
  "notes.changed": true,
  "sync.status": true,
  "updates.status": true,
  "security.status": true,
  "app.automation": true,
  "ai.status": true,
  "ai.event": true,
  "customizations.changed": true,
  "plugins.changed": true,
  "files.changed": true,
  "files.waiting": true,
};

export const LOAM_BRIDGE_EVENTS = Object.keys(EVENTS) as LoamBridgeEvent[];

/** The IPC channel events arrive on, as `(event name, payload)`. */
export const LOAM_BRIDGE_EVENT_CHANNEL = "loam-event";

/** The packaged window loads from `loam-app://app`; its links to notes may hold that origin. */
export const LOAM_APP_PROTOCOL = "loam-app";
export const LOAM_APP_HOST = "app";
export const LOAM_APP_ORIGIN = `${LOAM_APP_PROTOCOL}://${LOAM_APP_HOST}`;

export const LOAM_MEDIA_PROTOCOL = "loam-media";

export type LoamBridge = {
  invoke<M extends LoamBridgeMethod>(
    method: M,
    params: LoamBridgeParams<M>,
  ): Promise<BridgeResult<LoamBridgeResult<M>>>;
  /** Calls `listener` with each `event` from the main process; returns an unsubscribe. */
  on<E extends LoamBridgeEvent>(
    event: E,
    listener: (payload: LoamBridgeEvents[E]) => void,
  ): () => void;
  platform: string;
  /** Where a file dropped on the window is on this computer; empty when it isn't a file there. */
  pathForFile(file: File): string;
};

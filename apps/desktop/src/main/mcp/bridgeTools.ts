import { z } from "zod";

import type { LoamBridgeMethod, LoamBridgeParams } from "@loam/shared/bridge/loamBridge";
import type { NoteDocument } from "@loam/shared/notes/noteModel";

import { uuidSchema } from "../requests/params";
import { layoutSchema, newNoteSchema, noteDocumentSchema, notePatchSchema } from "./schemas";

export type ToolFlags = {
  readOnly?: true;
  destructive?: true;
  /** Save the window's pending edits first, so the tool reads and changes what the user sees. */
  flushFirst?: true;
};

/**
 * How AI clients reach one bridge request: through a tool with the same name
 * and params, or with an AI-shaped input. `false` means no tool, with the
 * reason in a comment; every request needs a decision.
 */
export type BridgeTool<M extends LoamBridgeMethod> =
  | false
  | (ToolFlags & {
      description: string;
      input?: {
        schema: z.ZodObject<z.ZodRawShape>;
        toParams: (input: never) => LoamBridgeParams<M>;
      };
    });

/** An AI-shaped input for a request, typed so it must produce that request's params. */
const aiInput = <S extends z.ZodRawShape, P>(
  shape: S,
  toParams: (input: z.output<z.ZodObject<S>>) => P,
) => ({ schema: z.strictObject(shape), toParams });

export const toolName = (method: string) =>
  `loam_${method
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replaceAll(".", "_")
    .toLowerCase()}`;

export const BRIDGE_TOOLS: { [M in LoamBridgeMethod]: BridgeTool<M> } = {
  "notes.library": {
    description:
      "List every project, folder and note summary in library order. A folder's projectId names its project; a note's projectId is set only outside folders. Use notes_get for full content.",
    readOnly: true,
    flushFirst: true,
  },
  "notes.get": {
    description:
      "Read a full note: all tabs, rich text blocks, diagrams, tables, video, placement and updatedAt.",
    readOnly: true,
    flushFirst: true,
  },
  "notes.create": {
    description:
      "Create a complete note with any combination of text, diagram and table tabs, images, links and video. IDs must be new; use notes_new for a simple note.",
    flushFirst: true,
    input: aiInput({ note: newNoteSchema }, ({ note }) => ({ note: note as NoteDocument })),
  },
  "notes.save": {
    description:
      "Patch a note. Omitted fields remain stored. Map fields replace the entire map: read first and preserve other tabs. null removes video or legacy graph. baseUpdatedAt must be the updatedAt from the last read; a stale one is rejected, so read again before retrying.",
    flushFirst: true,
    input: aiInput(
      { noteId: uuidSchema, patch: notePatchSchema, baseUpdatedAt: z.string().min(1) },
      ({ noteId, patch, baseUpdatedAt }) => ({
        noteId,
        patch: patch as LoamBridgeParams<"notes.save">["patch"],
        baseUpdatedAt,
      }),
    ),
  },
  "notes.delete": {
    description:
      "Delete a note and return its full document, which notes_restore can use to undo the deletion. History is retained.",
    destructive: true,
    flushFirst: true,
  },
  "notes.restore": {
    description:
      "Undo a deletion using the full document returned by notes_delete, preserving placement and content.",
    flushFirst: true,
    input: aiInput({ note: noteDocumentSchema }, ({ note }) => ({ note: note as NoteDocument })),
  },
  "notes.trash": {
    description: "List deleted notes available for recovery on this computer.",
    readOnly: true,
  },
  "notes.restoreTrash": {
    description: "Restore a note from persistent Trash with its content and original placement.",
    flushFirst: true,
  },
  "notes.deleteForever": {
    description:
      "Permanently delete a note and its version history from this computer's Trash. Earlier backups may still contain it.",
    destructive: true,
  },
  "notes.saveLayout": {
    description:
      "Replace the complete library layout to create, rename, remove or reorder projects and folders and move or reorder notes. Include every surviving note. Omitted projects or projectId fields keep what is stored. Removing a folder moves its notes to the top level of its project; removing a project moves its folders and notes to the library's top level.",
    flushFirst: true,
    input: aiInput({ layout: layoutSchema }, (input) => input),
  },
  "notes.backlinks": {
    description: "List notes linking to this note, including the total backlink count.",
    readOnly: true,
    flushFirst: true,
  },
  "notes.search": {
    description:
      "Search note text and titles with snippets, matching tab IDs and a hasMore flag. Use offset to retrieve further pages.",
    readOnly: true,
    flushFirst: true,
  },
  "notes.history": {
    description: "List a note's saved versions, newest first; the current note is not included.",
    readOnly: true,
    flushFirst: true,
  },
  "notes.version": {
    description: "Read the full content of a saved note version.",
    readOnly: true,
  },
  "notes.restoreVersion": {
    description:
      "Replace current note content with a saved version. Current content is preserved in history.",
    destructive: true,
    flushFirst: true,
  },
  "media.saveImage": {
    description:
      "Save an image (PNG, JPEG, GIF, WebP or AVIF; at most 10 MB) and return its local media URL for blocks or diagram nodes.",
    input: aiInput(
      {
        base64: z
          .string()
          .min(1)
          .max(14 * 1024 * 1024)
          .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
      },
      ({ base64 }) => ({ bytes: new Uint8Array(Buffer.from(base64, "base64")) }),
    ),
  },
  // Asks where to save with a native dialog; AI clients read images with media_read_image.
  "media.saveImageAs": false,
  // Writes to this computer's clipboard; AI clients read images with media_read_image.
  "media.copyImage": false,
  // File tabs' files: pickers, other apps and watches on this computer, for the person using the app.
  "files.import": false,
  "files.pick": false,
  "files.link": false,
  "files.copyIn": false,
  "files.read": false,
  "files.writeMarkdown": false,
  "files.openExternally": false,
  "files.takeBackCopy": false,
  "files.watch": false,
  "files.unwatch": false,
  "files.takeOpened": false,
  "app.info": {
    description: "Read the running app version, storage adapter and data directory.",
    readOnly: true,
  },
  "app.openDataDirectory": {
    description: "Open the notes data directory in the system file manager.",
  },
  // Native window colors only; workspace_set_theme changes the whole app's theme.
  "app.setTheme": false,
  // The window's own replies to workspace requests.
  "app.automationResult": false,
  // The window's theme files and snippets; workspace_set_theme picks a theme by id.
  "customizations.list": false,
  "customizations.reveal": false,
  // Plugins act in the window, with what the user granted them; AI clients use their own tools.
  "plugins.list": false,
  "plugins.setRestricted": false,
  "plugins.setEnabled": false,
  "plugins.setSetting": false,
  "plugins.source": false,
  "plugins.reveal": false,
  "plugins.call": false,
  "plugins.fetch": false,
  "plugins.storeGet": false,
  "plugins.storeSet": false,
  "plugins.googleStatus": false,
  "plugins.googleSignIn": false,
  "plugins.googleCalendar": false,
  "google.status": false,
  "google.configure": false,
  "google.signIn": false,
  "google.cancelSignIn": false,
  "google.signOut": false,
  "mcp.status": {
    description: "Read the local AI access status and endpoint; never returns a connection key.",
    readOnly: true,
  },
  // AI access consent and connection keys are managed only in the app's Settings.
  "mcp.configure": false,
  "mcp.connection": false,
  "mcp.rotateToken": false,
  // The side chat is the user's own assistant; AI clients neither read nor drive it.
  "ai.status": false,
  "ai.configure": false,
  "ai.setKey": false,
  "ai.transcribe": false,
  "ai.threads": false,
  "ai.thread": false,
  "ai.send": false,
  "ai.attachment": false,
  "ai.stop": false,
  "ai.respond": false,
  "ai.undo": false,
  "ai.setMode": false,
  "ai.renameThread": false,
  "ai.deleteThread": false,
  // Asks for a folder; AI clients name it in export_markdown.
  "export.markdown": false,
  "export.reveal": {
    description: "Open the most recent export directory in the system file manager.",
  },
  // The window's import steps; AI clients import end to end with import_run.
  "import.pick": false,
  "import.pickDropped": false,
  "import.images": false,
  "import.write": false,
  "import.finish": false,
  "backups.list": {
    description: "List backups, their directory and the last backup error.",
    readOnly: true,
  },
  "backups.create": {
    description: "Create a manual backup of the complete library.",
    flushFirst: true,
  },
  "backups.restore": {
    description:
      "Restore a listed backup, replacing the library after a safety backup. The app restarts and the MCP connection will close. secret opens an encrypted backup with another passphrase or recovery key.",
    destructive: true,
    flushFirst: true,
  },
  // Asks for a file; AI clients name it in backups_restore_file.
  "backups.restoreFile": false,
  "backups.openFolder": { description: "Open the backup folder in the system file manager." },
  "sync.status": {
    description: "Read the sync folder, state, unpublished changes and encryption requirements.",
    readOnly: true,
  },
  // Asks for a folder; AI clients name it in sync_choose_folder.
  "sync.chooseFolder": false,
  "sync.now": {
    description: "Publish local edits and receive remote changes now.",
    flushFirst: true,
  },
  "sync.turnOff": {
    description: "Disable sync while keeping local notes and files already in the sync folder.",
    flushFirst: true,
  },
  "sync.unlockFolder": {
    description:
      "Unlock and adopt an encrypted sync folder's key using its passphrase or recovery key.",
    flushFirst: true,
  },
  "security.status": {
    description:
      "Read library encryption status; the only tool that answers while the library is locked.",
    readOnly: true,
  },
  // Only the user unlocks the notes, in the app; AI clients get nothing while they are locked.
  "security.unlock": false,
  "security.resetPassphrase": false,
  "security.newRecoveryKey": {
    description:
      "Generate a recovery key before enabling encryption. Save it securely before continuing.",
  },
  // Asks where to save; AI clients name the file in security_save_recovery_key.
  "security.saveRecoveryKey": false,
  "security.enable": {
    description:
      "Encrypt the local library using a passphrase after generating and saving a recovery key.",
    flushFirst: true,
  },
  "security.changePassphrase": {
    description: "Change the library passphrase using the current passphrase.",
  },
  "security.disable": {
    description: "Remove encryption from the library using the current passphrase.",
    destructive: true,
    flushFirst: true,
  },
  "updates.status": {
    description: "Read app update availability and download progress.",
    readOnly: true,
  },
  "updates.check": {
    description: "Check for an app update; available updates download in the background.",
  },
  "updates.install": {
    description: "Restart into a downloaded app update. The MCP connection will close.",
  },
};

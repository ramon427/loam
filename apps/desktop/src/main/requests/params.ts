import { z } from "zod";

import type {
  BridgeImportNote,
  BridgeResult,
  LoamBridgeMethod,
  LoamBridgeParams,
} from "@loam/shared/bridge/loamBridge";
import type { NewNote, NoteDocument, NotePatch, NotesLayout } from "@loam/shared/notes/noteModel";
import {
  AI_ACCESS_MODES,
  AI_EFFORTS,
  AI_KEY_PROVIDER_IDS,
  AI_MODEL_ID,
  AI_PROVIDER_IDS,
  MAX_AI_ATTACHMENTS,
} from "@loam/shared/ai/aiChat";
import { FILE_TAB_KINDS } from "@loam/shared/notes/noteModel";
import { PLUGIN_OPS, type PluginOp } from "@loam/shared/plugins/pluginApi";
import { UUID_PATTERN } from "@loam/shared/utils/uuid";

/**
 * What each request may carry. The main process decodes every request's
 * params with its schema before running it; anything else is refused. Note
 * content is checked once, by the store, against the stored-note schema.
 */

export const idSchema = z.string().min(1).max(512);
/** A note or folder id: the store gives and accepts only UUIDs. */
export const uuidSchema = z.string().regex(UUID_PATTERN, "Note, folder and project ids are UUIDs.");
const secretSchema = z.string().max(1024);
const noParams = z.strictObject({});
const noteIdParams = z.strictObject({ noteId: idSchema });
/** For requests the store refuses unless the id is a UUID. */
const noteUuidParams = z.strictObject({ noteId: uuidSchema });
const versionParams = z.strictObject({ noteId: idSchema, versionId: idSchema });
const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);
const pluginIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/);

const threadIdParams = z.strictObject({ threadId: idSchema });
const accessModeSchema = z.enum(AI_ACCESS_MODES);
const chatContextSchema = z.strictObject({
  noteId: idSchema.nullable(),
  noteTitle: z.string().max(1000).nullable(),
  selection: z.string().max(100_000).nullable(),
  mentions: z
    .array(z.strictObject({ noteId: idSchema, title: z.string().max(1000) }))
    .max(20)
    .optional(),
});

const fileKind = z.enum(FILE_TAB_KINDS);
const filePath = z.string().min(1).max(4096);
/** A tab's file as the window holds it; the files service checks any path it names before reading. */
const noteFile = z.strictObject({
  name: z.string().max(1000),
  source: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("imported"), fileName: idSchema }),
    z.strictObject({ kind: z.literal("text"), text: z.string() }),
    z.strictObject({ kind: z.literal("referenced"), path: filePath, computerId: idSchema }),
  ]),
  page: z.number().int().positive().optional(),
});

export const importSourceSchema = z.enum(["markdown", "evernote", "notion", "html"]);

export const exportScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("all") }),
  z.strictObject({ kind: z.literal("note"), noteId: idSchema }),
]);

const isBridgeResult = (value: unknown): value is BridgeResult<unknown> =>
  typeof (value as { ok?: unknown } | null)?.ok === "boolean";

export const BRIDGE_PARAMS: { [M in LoamBridgeMethod]: z.ZodType<LoamBridgeParams<M>> } = {
  "notes.library": noParams,
  "notes.get": noteIdParams,
  "notes.create": z.strictObject({ note: z.custom<NewNote>() }),
  "notes.save": z.strictObject({
    noteId: idSchema,
    patch: z.custom<NotePatch>(),
    baseUpdatedAt: idSchema.optional(),
  }),
  "notes.delete": noteIdParams,
  "notes.restore": z.strictObject({ note: z.custom<NoteDocument>() }),
  "notes.trash": noParams,
  "notes.restoreTrash": noteUuidParams,
  "notes.deleteForever": noteUuidParams,
  "notes.saveLayout": z.strictObject({ layout: z.custom<NotesLayout>() }),
  "notes.backlinks": noteIdParams,
  "notes.search": z.strictObject({
    query: z.string().transform((query) => query.slice(0, 200)),
    limit: z.number().int().min(1).max(50).optional(),
    offset: z.number().int().nonnegative().optional(),
  }),
  "notes.history": noteIdParams,
  "notes.version": versionParams,
  "notes.restoreVersion": versionParams,
  "media.saveImage": z.strictObject({ bytes: z.instanceof(Uint8Array) }),
  "media.saveImageAs": z.strictObject({ reference: idSchema }),
  "media.copyImage": z.strictObject({ reference: idSchema }),
  "files.import": z.strictObject({ kind: fileKind }),
  "files.pick": noParams,
  "files.link": z.strictObject({ path: filePath }),
  "files.copyIn": z.strictObject({ kind: fileKind, file: noteFile }),
  "files.read": z.strictObject({ kind: fileKind, file: noteFile }),
  "files.writeMarkdown": z.strictObject({ file: noteFile, text: z.string() }),
  "files.openExternally": z.strictObject({ kind: fileKind, file: noteFile }),
  "files.takeBackCopy": z.strictObject({ kind: fileKind, path: filePath, name: z.string() }),
  "files.watch": z.strictObject({ kind: fileKind, path: filePath }),
  "files.unwatch": z.strictObject({ path: filePath }),
  "files.takeOpened": noParams,
  "app.info": noParams,
  "app.openDataDirectory": noParams,
  "app.setTheme": z.strictObject({
    theme: z.enum(["light", "dark"]),
    colors: z.strictObject({ color: hexColor, symbolColor: hexColor }).optional(),
    glass: z.boolean().optional(),
  }),
  "customizations.list": noParams,
  "customizations.reveal": z.strictObject({ kind: z.enum(["themes", "snippets"]) }),
  "plugins.list": noParams,
  "plugins.setRestricted": z.strictObject({ restrictedMode: z.boolean() }),
  "plugins.setEnabled": z.strictObject({
    id: pluginIdSchema,
    enabled: z.boolean(),
    granted: z.array(z.string().max(300)).max(32).optional(),
  }),
  "plugins.setSetting": z.strictObject({
    id: pluginIdSchema,
    key: z.string().max(64),
    value: z.union([z.string().max(10_000), z.number().finite(), z.boolean()]),
  }),
  "plugins.source": z.strictObject({ id: pluginIdSchema }),
  "plugins.reveal": noParams,
  "plugins.call": z.strictObject({
    id: pluginIdSchema,
    op: z.enum(PLUGIN_OPS as [PluginOp, ...PluginOp[]]),
    params: z.unknown(),
  }),
  "plugins.fetch": z.strictObject({
    id: pluginIdSchema,
    url: z.string().max(8192),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).optional(),
    headers: z.record(z.string().max(256), z.string().max(8192)).optional(),
    body: z.string().optional(),
  }),
  "plugins.storeGet": z.strictObject({ id: pluginIdSchema, key: z.string().min(1).max(200) }),
  "plugins.storeSet": z.strictObject({
    id: pluginIdSchema,
    key: z.string().min(1).max(200),
    value: z.unknown(),
  }),
  "app.automationResult": z.strictObject({
    requestId: idSchema,
    result: z.custom<BridgeResult<unknown>>(isBridgeResult),
  }),
  "mcp.status": noParams,
  "mcp.configure": z.strictObject({
    enabled: z.boolean(),
    port: z.number().int().min(1024).max(65535).optional(),
  }),
  "mcp.connection": noParams,
  "mcp.rotateToken": noParams,
  "ai.status": noParams,
  "ai.configure": z.strictObject({
    enabled: z.boolean().optional(),
    provider: z.enum(AI_PROVIDER_IDS).optional(),
    // Empty goes back to the provider's default model.
    model: z
      .string()
      .trim()
      .refine((model) => model === "" || AI_MODEL_ID.test(model), "That isn't a model id.")
      .optional(),
    baseUrl: z
      .string()
      .url()
      .max(500)
      .refine((url) => /^https?:\/\//.test(url), "Use an http or https URL.")
      .nullable()
      .optional(),
    defaultMode: accessModeSchema.optional(),
    effort: z.enum(AI_EFFORTS).nullable().optional(),
  }),
  "ai.transcribe": z.strictObject({
    // About ten minutes of speech at the bitrates browsers record.
    audio: z.instanceof(Uint8Array).refine((audio) => audio.byteLength <= 25 * 1024 * 1024),
    mimeType: z.string().regex(/^audio\/[\w.+-]+(;.*)?$/),
  }),
  "ai.setKey": z.strictObject({
    provider: z.enum(AI_KEY_PROVIDER_IDS),
    key: z.string().max(10_000).nullable(),
  }),
  "ai.threads": noParams,
  "ai.thread": threadIdParams,
  "ai.send": z
    .strictObject({
      threadId: idSchema.nullable(),
      text: z.string().trim().max(100_000),
      context: chatContextSchema.nullable(),
      mode: accessModeSchema,
      attachments: z
        .array(
          z.strictObject({
            name: z.string().min(1).max(500),
            bytes: z.instanceof(Uint8Array),
            text: z.string().max(2_000_000).nullable(),
          }),
        )
        .max(MAX_AI_ATTACHMENTS)
        .optional(),
    })
    .refine(
      ({ text, attachments }) => text.length > 0 || Boolean(attachments?.length),
      "A message needs text or a file.",
    ),
  "ai.attachment": z.strictObject({ threadId: idSchema, attachmentId: idSchema }),
  "ai.stop": threadIdParams,
  "ai.respond": z.strictObject({
    threadId: idSchema,
    approvalId: idSchema,
    decision: z.enum(["accept", "accept-for-chat", "decline"]),
  }),
  "ai.undo": z.strictObject({ threadId: idSchema, actionIds: z.array(idSchema).max(500) }),
  "ai.setMode": z.strictObject({ threadId: idSchema, mode: accessModeSchema }),
  "ai.renameThread": z.strictObject({ threadId: idSchema, title: z.string().max(500) }),
  "ai.deleteThread": threadIdParams,
  "export.markdown": z.strictObject({ scope: exportScopeSchema }),
  "export.reveal": noParams,
  "import.pick": noParams,
  "import.pickDropped": z.strictObject({ paths: z.array(filePath).min(1).max(10_000) }),
  "import.images": z.strictObject({
    sessionId: idSchema,
    requests: z.array(z.strictObject({ fromPath: z.string(), reference: z.string() })),
  }),
  "import.write": z.strictObject({
    sessionId: idSchema,
    notes: z.array(z.custom<BridgeImportNote>()).max(1000),
  }),
  "import.finish": z.strictObject({ sessionId: idSchema }),
  "backups.list": noParams,
  "backups.create": noParams,
  "backups.restore": z.strictObject({ backupId: idSchema, secret: secretSchema.optional() }),
  "backups.restoreFile": z.strictObject({ secret: secretSchema.optional() }),
  "backups.openFolder": noParams,
  "sync.status": noParams,
  "sync.chooseFolder": noParams,
  "sync.now": noParams,
  "sync.turnOff": noParams,
  "sync.unlockFolder": z.strictObject({ secret: secretSchema }),
  "security.status": noParams,
  "security.unlock": z.strictObject({ passphrase: secretSchema }),
  "security.resetPassphrase": z.strictObject({
    recoveryKey: secretSchema,
    passphrase: secretSchema,
  }),
  "security.newRecoveryKey": noParams,
  "security.saveRecoveryKey": noParams,
  "security.enable": z.strictObject({ passphrase: secretSchema, recoveryKey: secretSchema }),
  "security.changePassphrase": z.strictObject({ current: secretSchema, next: secretSchema }),
  "security.disable": z.strictObject({ passphrase: secretSchema }),
  "updates.status": noParams,
  "updates.check": noParams,
  "updates.install": noParams,
};

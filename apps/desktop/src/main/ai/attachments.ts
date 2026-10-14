import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  MAX_AI_IMAGE_ATTACHMENTS,
  type AiAttachment,
  type AiAttachmentUpload,
} from "@loam/shared/ai/aiChat";
import { writeFileAtomic } from "@loam/storage/files";
import { openFile, sealFile, type DataKey } from "@loam/storage/encryption/seal";
import { StoreError } from "@loam/storage/storeError";

import { imageTypeOf } from "../mediaStore";
import type { TurnAttachment } from "./providers/types";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 32 * 1024 * 1024;
const MAX_TEXT_CHARS = 1_000_000;
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const refuse = (message: string) => new StoreError(message, "VALIDATION_ERROR", 400);

const readText = (bytes: Buffer) => {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

/** What a file sent with a message is, going by its bytes, and the text it is read as. */
const classify = (
  upload: AiAttachmentUpload,
): { kind: AiAttachment["kind"]; mimeType: string; text: string | null } => {
  const bytes = Buffer.from(upload.bytes.buffer, upload.bytes.byteOffset, upload.bytes.byteLength);
  const image = imageTypeOf(bytes);
  if (image && image !== "image/avif") {
    if (bytes.byteLength > MAX_IMAGE_BYTES)
      throw refuse(`"${upload.name}" is over 5MB; models take images up to 5MB.`);
    return { kind: "image", mimeType: image, text: null };
  }
  if (bytes.subarray(0, 1024).includes("%PDF-")) {
    if (bytes.byteLength > MAX_PDF_BYTES) throw refuse(`"${upload.name}" is over 32MB.`);
    return { kind: "pdf", mimeType: "application/pdf", text: upload.text };
  }
  // A Word document goes as the text the window read from it.
  if (bytes.subarray(0, 4).equals(ZIP_SIGNATURE) && bytes.includes("word/document.xml")) {
    if (!upload.text) throw refuse(`"${upload.name}" has no text to send.`);
    return { kind: "text", mimeType: "text/plain", text: upload.text.slice(0, MAX_TEXT_CHARS) };
  }
  const text = readText(bytes);
  if (text === null)
    throw refuse(`"${upload.name}" can't be sent; send images, PDFs, Word documents or text.`);
  if (text.length > MAX_TEXT_CHARS) throw refuse(`"${upload.name}" is too long to send.`);
  return { kind: "text", mimeType: "text/plain", text };
};

const sealContext = (threadId: string, fileName: string) => `ai-attachment:${threadId}:${fileName}`;

/**
 * Files sent in chats, kept beside the chats in a folder per chat: the file
 * as attached, and the text it was read as. Sealed with the library's key
 * while encryption is on, like the chats.
 */
export const createAttachmentStore = ({
  directory,
  key,
}: {
  directory: string;
  key: () => DataKey | null;
}) => {
  const write = async (threadId: string, fileName: string, plain: Uint8Array) => {
    const sealWith = key();
    await mkdir(join(directory, threadId), { recursive: true });
    await writeFileAtomic(
      join(directory, threadId, fileName),
      sealWith ? sealFile(sealWith, plain, sealContext(threadId, fileName)) : plain,
      { mode: 0o600 },
    );
  };
  const open = async (threadId: string, fileName: string, keys = [key()]) => {
    try {
      const sealed = await readFile(join(directory, threadId, fileName));
      return openFile(keys, sealed, sealContext(threadId, fileName));
    } catch {
      throw new StoreError("That file is no longer there.", "NOT_FOUND", 404);
    }
  };

  /** What each file is, going by its bytes; throws for a file a model can't read. */
  const check = (uploads: readonly AiAttachmentUpload[]) => {
    const classified = uploads.map((upload) => ({ upload, ...classify(upload) }));
    if (classified.filter((file) => file.kind === "image").length > MAX_AI_IMAGE_ATTACHMENTS)
      throw refuse(`Send at most ${MAX_AI_IMAGE_ATTACHMENTS} images with a message.`);
    return classified;
  };

  return {
    check,
    /** Keeps the files sent with a message, checked by what their bytes are. */
    async add(threadId: string, uploads: readonly AiAttachmentUpload[]): Promise<AiAttachment[]> {
      const classified = check(uploads);
      const attachments: AiAttachment[] = [];
      for (const { upload, kind, mimeType, text } of classified) {
        const id = randomUUID();
        await write(threadId, id, upload.bytes);
        if (text !== null) await write(threadId, `${id}.txt`, new TextEncoder().encode(text));
        attachments.push({ id, name: upload.name, kind, mimeType, size: upload.bytes.byteLength });
      }
      return attachments;
    },

    /** A file as the model gets it. */
    async forTurn(threadId: string, attachment: AiAttachment): Promise<TurnAttachment> {
      const data = await open(threadId, attachment.id);
      const text =
        attachment.kind === "image"
          ? null
          : await open(threadId, `${attachment.id}.txt`)
              .then((bytes) => bytes.toString("utf8"))
              .catch(() => null);
      return {
        name: attachment.name,
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        data,
        text,
      };
    },

    /** A file as it was attached, to show it in the chat. */
    bytes: (threadId: string, attachmentId: string) => open(threadId, attachmentId),

    async removeThread(threadId: string) {
      await rm(join(directory, threadId), { recursive: true, force: true });
    },

    /** Seals every file with the library's current key; `previous` opens them as they are. */
    async reseal(previous: DataKey | null) {
      const threads = await readdir(directory).catch(() => [] as string[]);
      for (const threadId of threads)
        for (const fileName of await readdir(join(directory, threadId)).catch(() => []))
          // A file a write left half done starts with a dot; it holds nothing to keep.
          if (!fileName.startsWith("."))
            await write(threadId, fileName, await open(threadId, fileName, [previous, key()]));
    },
  };
};

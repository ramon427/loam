import type { BridgeImportNote, BridgeImportSkip } from "@loam/shared/bridge/loamBridge";

import {
  collectImageReferences,
  decodeBase64,
  resolveImportedBlocks,
  textNote,
} from "./importBlocks";
import { removeUnsafeElements } from "./cleanHtml";
import {
  createImportProgress,
  type ImportConverterInput,
  type ImportConverterOutput,
} from "./importTypes";
import { md5Hex } from "./md5";
import { IMPORT_IMAGE_SCHEME, encodeImportDestination } from "./obsidianSyntax";

/** The image types Loam stores; other attachments are listed as skipped. */
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type Resource = { bytes: Uint8Array<ArrayBuffer>; mimeType: string; name: string };

export type EvernoteImportInput = Pick<
  ImportConverterInput,
  "files" | "createId" | "parseHtml" | "saveImageBytes" | "onProgress"
>;

const childText = (parent: Element, selector: string) =>
  parent.querySelector(`:scope > ${selector}`)?.textContent?.trim() ?? "";

const readResources = (note: Element) => {
  const resources = new Map<string, Resource>();
  for (const resource of note.querySelectorAll(":scope > resource")) {
    const data = resource.querySelector(":scope > data")?.textContent;
    if (!data) continue;
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = decodeBase64(data);
    } catch {
      continue;
    }
    const name =
      resource.querySelector("resource-attributes > file-name")?.textContent?.trim() ||
      "attachment";
    resources.set(md5Hex(bytes), {
      bytes,
      mimeType: childText(resource, "mime").toLowerCase(),
      name,
    });
  }
  return resources;
};

/** Evernote marks checklists and code blocks with style flags rather than elements. */
const hasStyleFlag = (element: Element, flag: string) =>
  (element.getAttribute("style") ?? "").replace(/\s+/g, "").includes(`${flag}:true`);

const checkbox = (document: Document, checked: boolean) => {
  const input = document.createElement("input");
  input.setAttribute("type", "checkbox");
  if (checked) input.setAttribute("checked", "");
  return input;
};

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/**
 * ENML is XML, so `<en-todo/>` closes itself, but an HTML parser ignores the
 * slash on anything but void elements and would pull the following text
 * inside. ENML also uses HTML entities such as `&nbsp;` that an XML parser
 * rejects, so it is parsed as HTML with those tags written out in full.
 */
const expandSelfClosingTags = (enml: string) =>
  enml.replace(/<([a-zA-Z][\w:-]*)(\s[^<>]*?)?\s*\/>/g, (tag, name: string, attributes = "") =>
    VOID_ELEMENTS.has(name.toLowerCase()) ? tag : `<${name}${attributes}></${name}>`,
  );

/**
 * ENML is Evernote's XHTML dialect. Rewrites its own elements into the HTML
 * BlockNote understands: attachments into images, to-dos into checklists,
 * code-block divs into `<pre>`, and drops anything executable or interactive.
 */
const enmlToHtml = (
  enml: string,
  resources: Map<string, Resource>,
  skip: (name: string, reason: string) => void,
) => {
  const document = new DOMParser().parseFromString(expandSelfClosingTags(enml), "text/html");
  const root = document.querySelector("en-note") ?? document.body;
  removeUnsafeElements(root);

  for (const media of root.querySelectorAll("en-media")) {
    const hash = (media.getAttribute("hash") ?? "").toLowerCase();
    const resource = resources.get(hash);
    if (resource && SUPPORTED_IMAGE_TYPES.has(resource.mimeType)) {
      const image = document.createElement("img");
      image.setAttribute("src", encodeImportDestination(IMPORT_IMAGE_SCHEME, hash));
      image.setAttribute("alt", resource.name);
      media.replaceWith(image);
      continue;
    }
    const name = resource?.name ?? "attachment";
    skip(
      name,
      resource?.mimeType.startsWith("image/")
        ? "Image type is not supported (use PNG, JPEG, GIF, WebP or AVIF)"
        : "Attachments other than images are not imported",
    );
    const note = document.createElement("p");
    note.textContent = `Attachment not imported: ${name}`;
    media.replaceWith(note);
  }

  for (const encrypted of root.querySelectorAll("en-crypt")) {
    skip("Encrypted text", "Encrypted text can't be imported");
    const note = document.createElement("p");
    note.textContent = "Encrypted text was not imported.";
    encrypted.replaceWith(note);
  }

  // Classic to-dos: <div><en-todo checked="true"/>Buy milk</div>.
  for (const todo of root.querySelectorAll("en-todo")) {
    const block = todo.closest("div, p, li") ?? todo.parentElement;
    const checked = todo.getAttribute("checked") === "true";
    if (!block || block === root) {
      todo.replaceWith(checkbox(document, checked));
      continue;
    }
    todo.remove();
    const list = document.createElement("ul");
    const item = document.createElement("li");
    item.append(checkbox(document, checked), ...block.childNodes);
    list.append(item);
    block.replaceWith(list);
  }
  // Evernote 10 checklists: <ul style="--en-todo:true"><li style="--en-checked:true">.
  for (const list of root.querySelectorAll("ul")) {
    if (!hasStyleFlag(list, "--en-todo")) continue;
    for (const item of list.querySelectorAll(":scope > li")) {
      item.prepend(checkbox(document, hasStyleFlag(item, "--en-checked")));
    }
  }
  // Evernote 10 code blocks: a div flagged as code holding one div per line.
  for (const block of root.querySelectorAll("div")) {
    if (!hasStyleFlag(block, "--en-codeblock")) continue;
    const lines = [...block.children].map((line) => line.textContent ?? "");
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = (lines.length ? lines : [block.textContent ?? ""]).join("\n");
    pre.append(code);
    block.replaceWith(pre);
  }
  return root.innerHTML;
};

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);

/** Tags and the clipped page's address have no Loam equivalent, so they stay visible as text. */
const buildFooterHtml = (tags: string[], sourceUrl: string) => {
  const parts: string[] = [];
  if (tags.length) parts.push(`<p>Tags: ${tags.map(escapeHtml).join(", ")}</p>`);
  if (/^https?:\/\//i.test(sourceUrl)) {
    const url = escapeHtml(sourceUrl);
    parts.push(`<p>Source: <a href="${url}">${url}</a></p>`);
  }
  return parts.join("");
};

/**
 * Converts Evernote `.enex` exports: one folder per notebook file, one note per
 * `<note>`, attached images copied into Loam and checklists kept as checklists.
 */
export async function convertEvernoteImport({
  files,
  createId,
  parseHtml,
  saveImageBytes,
  onProgress,
}: EvernoteImportInput): Promise<ImportConverterOutput> {
  const notes: BridgeImportNote[] = [];
  const skipped: BridgeImportSkip[] = [];

  // Read every notebook first, so progress can count all notes.
  const notebooks = files.flatMap((file) => {
    const xml = new DOMParser().parseFromString(file.text, "application/xml");
    const exportRoot = xml.querySelector("en-export");
    if (xml.querySelector("parsererror") || !exportRoot) {
      skipped.push({ path: file.path, reason: "Not a valid Evernote export" });
      return [];
    }
    const name = (file.path.split("/").at(-1) ?? file.path).replace(/\.enex$/i, "").trim();
    return [{ name, notes: [...exportRoot.querySelectorAll(":scope > note")] }];
  });
  const step = createImportProgress(
    notebooks.reduce((count, notebook) => count + notebook.notes.length, 0),
    onProgress,
  );

  for (const { name: notebook, notes: notebookNotes } of notebooks) {
    for (const note of notebookNotes) {
      await step();
      const title = childText(note, "title") || "Untitled";
      const where = `${notebook}/${title}`;
      const skip = (name: string, reason: string) =>
        skipped.push({ path: `${where}: ${name}`, reason });
      const resources = readResources(note);
      const html =
        enmlToHtml(childText(note, "content"), resources, skip) +
        buildFooterHtml(
          [...note.querySelectorAll(":scope > tag")].map((tag) => tag.textContent?.trim() ?? ""),
          note.querySelector("note-attributes > source-url")?.textContent?.trim() ?? "",
        );

      let blocks: unknown[];
      try {
        blocks = await parseHtml(html);
      } catch {
        skipped.push({ path: where, reason: "Could not read the note" });
        continue;
      }

      const urls = new Map<string, string>();
      for (const hash of new Set(collectImageReferences(blocks))) {
        const resource = resources.get(hash);
        if (!resource) continue;
        try {
          urls.set(hash, await saveImageBytes(resource.bytes));
        } catch (error) {
          skip(resource.name, error instanceof Error ? error.message : "Could not save the image");
        }
      }

      notes.push(
        textNote({
          id: createId(),
          title,
          folder: notebook || null,
          tabId: createId(),
          blocks: resolveImportedBlocks(blocks, {
            resolveNote: () => null,
            // Links between Evernote notes use ids the export doesn't include.
            resolveRelative: () => null,
            resolveImage: (hash) => urls.get(hash) ?? null,
          }),
        }),
      );
    }
  }
  return { notes, skipped };
}

import type { BridgeImportNote, BridgeImportSkip } from "@loam/shared/bridge/loamBridge";

import {
  copyReferencedImages,
  resolveImportedBlocks,
  saveEmbeddedImages,
  textNote,
} from "./importBlocks";
import { removeUnsafeElements } from "./cleanHtml";
import { fileNameOf } from "./importPaths";
import {
  createImportProgress,
  type ImportConverterInput,
  type ImportConverterOutput,
} from "./importTypes";

export type HtmlImportInput = Pick<
  ImportConverterInput,
  "files" | "createId" | "parseHtml" | "saveImages" | "saveImageBytes" | "onProgress"
>;

const withoutExtension = (name: string) => name.replace(/\.html?$/i, "");

/** The page's title and body, without its first heading when that repeats the title. */
const readPage = (path: string, html: string) => {
  const document = new DOMParser().parseFromString(html, "text/html");
  removeUnsafeElements(document);
  const firstHeading = document.body.querySelector("h1");
  const title =
    document.title.trim() ||
    firstHeading?.textContent?.trim() ||
    withoutExtension(fileNameOf(path)) ||
    "Untitled";
  const first = document.body.firstElementChild;
  if (first?.tagName === "H1" && first.textContent?.trim() === title) first.remove();
  return { title, body: document.body.innerHTML };
};

/**
 * Converts HTML pages (what Apple Notes exporters and "save as web page"
 * produce): one note per file, images beside the file or embedded in it
 * copied in, and links between the picked pages kept.
 */
export async function convertHtmlImport({
  files,
  createId,
  parseHtml,
  saveImages,
  saveImageBytes,
  onProgress,
}: HtmlImportInput): Promise<ImportConverterOutput> {
  const skipped: BridgeImportSkip[] = [];
  const pages = files.flatMap((file) => {
    if (/\.html?$/i.test(file.path)) return [{ id: createId(), file }];
    skipped.push({ path: file.path, reason: "Not an HTML file" });
    return [];
  });
  const idByName = new Map(pages.map((page) => [page.file.path.toLowerCase(), page.id]));

  const parsed: Array<{ page: (typeof pages)[number]; title: string; blocks: unknown[] }> = [];
  const step = createImportProgress(pages.length, onProgress);
  for (const page of pages) {
    await step();
    const { title, body } = readPage(page.file.path, page.file.text);
    try {
      const blocks = await saveEmbeddedImages(await parseHtml(body), saveImageBytes, (reason) =>
        skipped.push({ path: `${page.file.path}: embedded image`, reason }),
      );
      parsed.push({ page, title, blocks });
    } catch {
      skipped.push({ path: page.file.path, reason: "Could not read the page" });
    }
  }

  const imageFor = await copyReferencedImages(
    parsed.map(({ page, blocks }) => ({ path: page.file.path, blocks })),
    saveImages,
    skipped,
  );

  const notes: BridgeImportNote[] = parsed.map(({ page, title, blocks }) => {
    // Picked pages sit side by side, so a link to another one names it by file name.
    const resolveRelative = (path: string) => idByName.get(fileNameOf(path).toLowerCase()) ?? null;
    return textNote({
      id: page.id,
      title,
      folder: null,
      tabId: createId(),
      blocks: resolveImportedBlocks(blocks, {
        resolveNote: () => null,
        resolveRelative,
        resolveImage: imageFor(page.file.path),
      }),
    });
  });
  return { notes, skipped };
}

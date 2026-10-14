import type { BridgeImportSource } from "@loam/shared/bridge/loamBridge";
import { convertEvernoteImport } from "@loam/transfer/import/evernoteImport";
import { convertHtmlImport } from "@loam/transfer/import/htmlImport";
import type { ImportConverter } from "@loam/transfer/import/importTypes";
import { convertMarkdownImport } from "@loam/transfer/import/markdownImport";
import { convertNotionImport } from "@loam/transfer/import/notionImport";

/** Converters by source; loaded only when an import starts. */
export const IMPORT_CONVERTERS: Record<BridgeImportSource, ImportConverter> = {
  markdown: convertMarkdownImport,
  evernote: convertEvernoteImport,
  notion: convertNotionImport,
  html: convertHtmlImport,
};

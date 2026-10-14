import type {
  BridgeImportFile,
  BridgeImportNote,
  BridgeImportSkip,
} from "@loam/shared/bridge/loamBridge";
import type { NoteTable } from "@loam/shared/notes/noteModel";

import { parseCsv } from "./csv";
import { copyReferencedImages, resolveImportedBlocks, textNote } from "./importBlocks";
import { removeUnsafeElements } from "./cleanHtml";
import { directoryOf, fileNameOf, folderNameFor, normalizePath } from "./importPaths";
import {
  createImportProgress,
  type ImportConverterInput,
  type ImportConverterOutput,
} from "./importTypes";

/** Notion appends a 32-character id to every page, database and folder name. */
const NOTION_ID_PATTERN = /\s+[0-9a-f]{32}$/i;
const PAGE_FILE_PATTERN = /\.(?:md|markdown|html)$/i;
const DATABASE_FILE_PATTERN = /\.csv$/i;
const MAX_TABLE_ROWS = 2_000;
const MAX_TABLE_COLUMNS = 50;

export type NotionImportInput = Pick<
  ImportConverterInput,
  "files" | "createId" | "parseMarkdown" | "parseHtml" | "saveImages" | "onProgress"
>;

type PlannedPage = {
  id: string;
  file: BridgeImportFile;
  /** The path inside the export, with Notion's shared top folder removed. */
  path: string;
  title: string;
  folder: string | null;
  kind: "markdown" | "html" | "database";
};

const extensionOf = (path: string) => /\.[^./]+$/.exec(path)?.[0] ?? "";

/** "Project plan 1a2b…" (32 hex) becomes "Project plan". */
export const cleanNotionName = (name: string) => name.replace(NOTION_ID_PATTERN, "").trim();

const titleFromPath = (path: string) =>
  cleanNotionName(fileNameOf(path).slice(0, -extensionOf(path).length)) || "Untitled";

/** Exports of a whole workspace wrap every page in one folder; it adds nothing as a folder. */
const sharedTopFolder = (paths: string[]) => {
  const first = paths[0]?.split("/")[0];
  return first && paths.every((path) => path.split("/").length > 1 && path.startsWith(`${first}/`))
    ? `${first}/`
    : "";
};

/** Databases come as `Name.csv` and, in newer exports, also `Name_all.csv`; the latter is complete. */
const pickDatabaseFiles = (files: BridgeImportFile[]) => {
  const paths = new Set(files.map((file) => file.path.toLowerCase()));
  return files.filter((file) => {
    const path = file.path.toLowerCase();
    if (!path.endsWith(".csv") || path.endsWith("_all.csv")) return true;
    return !paths.has(path.replace(/\.csv$/, "_all.csv"));
  });
};

const planPages = (files: BridgeImportFile[], createId: () => string) => {
  const skipped: BridgeImportSkip[] = [];
  const kept = pickDatabaseFiles(
    files.filter((file) => {
      if (PAGE_FILE_PATTERN.test(file.path) || DATABASE_FILE_PATTERN.test(file.path)) return true;
      skipped.push({ path: file.path, reason: "Not a Notion page" });
      return false;
    }),
  );
  const top = sharedTopFolder(kept.map((file) => file.path));
  const pages = kept
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file): PlannedPage => {
      const path = file.path.slice(top.length);
      return {
        id: createId(),
        file,
        path,
        title: titleFromPath(path.replace(/_all\.csv$/i, ".csv")),
        folder: folderNameFor(path, cleanNotionName),
        kind: DATABASE_FILE_PATTERN.test(path)
          ? "database"
          : /\.html$/i.test(path)
            ? "html"
            : "markdown",
      };
    });
  return { pages, skipped };
};

/** Links inside an export point at files by their path relative to the linking page. */
const createPathResolver = (pages: PlannedPage[]) => {
  const byPath = new Map<string, string>();
  for (const page of pages) {
    byPath.set(page.file.path.toLowerCase(), page.id);
    // A link may name either database file.
    if (page.kind === "database")
      byPath.set(page.file.path.replace(/_all\.csv$/i, ".csv").toLowerCase(), page.id);
  }
  return (fromPath: string, target: string) => {
    const resolved = normalizePath(`${directoryOf(fromPath)}/${target}`);
    return resolved === null ? null : (byPath.get(resolved.toLowerCase()) ?? null);
  };
};

/** Notion writes callouts as raw `<aside>` HTML inside Markdown; make them quotes. */
const calloutsToQuotes = (markdown: string) =>
  markdown.replace(/<aside>\s*([\s\S]*?)\s*<\/aside>/g, (_, body: string) =>
    body
      .split("\n")
      .map((line) => `> ${line}`.trimEnd())
      .join("\n"),
  );

/** Notion repeats the title as the first heading; the note already has it. */
const withoutTitleHeading = (markdown: string, title: string) => {
  const match = /^\s*#\s+(.+?)\s*(?:\r?\n|$)/.exec(markdown);
  return match && match[1]!.trim().toLowerCase() === title.toLowerCase()
    ? markdown.slice(match[0].length)
    : markdown;
};

/** The page content of an HTML export: its property table and body, without the title. */
const notionPageHtml = (html: string) => {
  const document = new DOMParser().parseFromString(html, "text/html");
  removeUnsafeElements(document);
  const properties = document.querySelector("table.properties")?.outerHTML ?? "";
  const body = document.querySelector(".page-body") ?? document.body;
  return properties + body.innerHTML;
};

const buildDatabaseTable = (
  text: string,
  createId: () => string,
): { table: NoteTable; truncated: boolean } => {
  const [header = [], ...rows] = parseCsv(text).filter((row) => row.some((cell) => cell !== ""));
  const columns = header.slice(0, MAX_TABLE_COLUMNS).map((title, position) => ({
    id: createId(),
    title: title.trim() || `Column ${position + 1}`,
    type: "text" as const,
    width: 180,
    position,
  }));
  if (columns.length === 0)
    columns.push({ id: createId(), title: "Name", type: "text", width: 180, position: 0 });
  return {
    table: {
      columns,
      rows: rows.slice(0, MAX_TABLE_ROWS).map((row, position) => ({
        id: createId(),
        position,
        cells: Object.fromEntries(columns.map((column, index) => [column.id, row[index] ?? ""])),
      })),
    },
    truncated: rows.length > MAX_TABLE_ROWS || header.length > MAX_TABLE_COLUMNS,
  };
};

/**
 * Converts a Notion export (Markdown & CSV or HTML): one note per page with
 * the page hierarchy as folders, links between pages kept, images copied from
 * the export, and each database as a note with a table tab.
 */
export async function convertNotionImport({
  files,
  createId,
  parseMarkdown,
  parseHtml,
  saveImages,
  onProgress,
}: NotionImportInput): Promise<ImportConverterOutput> {
  const { pages, skipped } = planPages(files, createId);
  const step = createImportProgress(pages.length, onProgress);
  const resolvePath = createPathResolver(pages);
  const notes: BridgeImportNote[] = [];
  const parsed = new Map<string, unknown[]>();

  for (const page of pages) {
    await step();
    if (page.kind === "database") {
      const { table, truncated } = buildDatabaseTable(page.file.text, createId);
      if (truncated)
        skipped.push({
          path: page.path,
          reason: `Only the first ${MAX_TABLE_ROWS} rows and ${MAX_TABLE_COLUMNS} columns were imported`,
        });
      const tabId = createId();
      notes.push({
        id: page.id,
        title: page.title,
        folder: page.folder,
        tabs: [{ id: tabId, title: "Table", kind: "table" }],
        blocksByTab: { [tabId]: [] },
        tablesByTab: { [tabId]: table },
        activeTabId: tabId,
      });
      continue;
    }
    try {
      parsed.set(
        page.id,
        page.kind === "html"
          ? await parseHtml(notionPageHtml(page.file.text))
          : await parseMarkdown(withoutTitleHeading(calloutsToQuotes(page.file.text), page.title)),
      );
    } catch {
      skipped.push({ path: page.path, reason: "Could not read the page" });
    }
  }

  const textPages = pages.filter((page) => parsed.has(page.id));
  const imageFor = await copyReferencedImages(
    textPages.map((page) => ({ path: page.file.path, blocks: parsed.get(page.id)! })),
    saveImages,
    skipped,
  );

  for (const page of textPages) {
    const resolveRelative = (target: string) => resolvePath(page.file.path, target);
    notes.push(
      textNote({
        id: page.id,
        title: page.title,
        folder: page.folder,
        tabId: createId(),
        blocks: resolveImportedBlocks(parsed.get(page.id)!, {
          resolveNote: resolveRelative,
          resolveRelative,
          resolveImage: imageFor(page.file.path, page.path),
        }),
      }),
    );
  }

  const order = new Map(pages.map((page, index) => [page.id, index]));
  notes.sort((left, right) => order.get(left.id)! - order.get(right.id)!);
  return { notes, skipped };
}

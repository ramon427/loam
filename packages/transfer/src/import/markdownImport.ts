// Shared video parsing and JSON Canvas conversion keep imports consistent with the editor.
import { parseYouTubeUrl } from "@loam/shared/notes/noteVideo";
import { parseNoteGraphJsonCanvas } from "../canvas/noteGraphJsonCanvas";
import type {
  BridgeImportFile,
  BridgeImportNote,
  BridgeImportSkip,
} from "@loam/shared/bridge/loamBridge";
import type { NoteVideo } from "@loam/shared/notes/noteModel";

import {
  parseFrontMatter,
  readFrontMatterList,
  readFrontMatterString,
} from "../markdown/frontMatter";
import { encodeLinkDestination } from "../markdown/inlineMarkdown";
import { copyReferencedImages, resolveImportedBlocks, textNote } from "./importBlocks";
import { directoryOf, fileNameOf, folderNameFor, normalizePath } from "./importPaths";
import {
  createImportProgress,
  type ImportConverterInput,
  type ImportConverterOutput,
} from "./importTypes";
import { rewriteObsidianMarkdown } from "./obsidianSyntax";

const MARKDOWN_FILE_PATTERN = /\.(?:md|markdown)$/i;
const CANVAS_FILE_PATTERN = /\.canvas$/i;

type PlannedNote = {
  id: string;
  path: string;
  title: string;
  folder: string | null;
  format: "markdown" | "canvas";
  body: string;
  video?: NoteVideo;
  aliases: string[];
};

export type MarkdownImportInput = Pick<
  ImportConverterInput,
  "files" | "createId" | "parseMarkdown" | "saveImages" | "onProgress"
>;

const withoutNoteExtension = (path: string) => path.replace(MARKDOWN_FILE_PATTERN, "");

const readVideo = (url: string | undefined): NoteVideo | undefined => {
  const parsed = url ? parseYouTubeUrl(url) : null;
  return parsed ? { url: parsed.url, videoId: parsed.videoId } : undefined;
};

/**
 * Loam's export writes a "Video: [title](url)" line under the front matter for
 * other apps. The video comes back from the front matter, so that line goes.
 */
const withoutExportedVideoLine = (body: string, videoUrl: string | undefined) => {
  if (!videoUrl) return body;
  const match = /^\s*Video: \[[^\n]*\]\(([^)\s]+)\)[ \t]*(?:\r?\n|$)/.exec(body);
  return match?.[1] === encodeLinkDestination(videoUrl) ? body.slice(match[0].length) : body;
};

const planNotes = (files: BridgeImportFile[], createId: () => string) => {
  const notes: PlannedNote[] = [];
  const skipped: BridgeImportSkip[] = [];
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    const name = fileNameOf(file.path);
    if (CANVAS_FILE_PATTERN.test(name)) {
      notes.push({
        id: createId(),
        path: file.path,
        title: name.replace(CANVAS_FILE_PATTERN, ""),
        folder: folderNameFor(file.path),
        format: "canvas",
        body: file.text,
        aliases: [],
      });
      continue;
    }
    if (!MARKDOWN_FILE_PATTERN.test(name)) {
      skipped.push({ path: file.path, reason: "Not a Markdown file" });
      continue;
    }
    const { fields, body } = parseFrontMatter(file.text);
    const videoUrl = readFrontMatterString(fields, "video");
    notes.push({
      id: createId(),
      path: file.path,
      title: readFrontMatterString(fields, "title") ?? withoutNoteExtension(name),
      folder: folderNameFor(file.path),
      format: "markdown",
      body: rewriteObsidianMarkdown(withoutExportedVideoLine(body, videoUrl)),
      video: readVideo(videoUrl),
      aliases: readFrontMatterList(fields, "aliases"),
    });
  }
  return { notes, skipped };
};

/**
 * Finds the note a link points at the way Obsidian does: a path is tried
 * relative to the linking note and then from the root, and a bare name matches
 * any note with that file name, title or alias, preferring the same folder.
 */
const createNoteResolver = (notes: PlannedNote[]) => {
  const byPath = new Map<string, PlannedNote>();
  const byName = new Map<string, PlannedNote[]>();
  const addName = (name: string, note: PlannedNote) => {
    const key = name.trim().toLowerCase();
    if (!key) return;
    const list = byName.get(key) ?? [];
    if (!list.includes(note)) list.push(note);
    byName.set(key, list);
  };
  for (const note of notes) {
    byPath.set(withoutNoteExtension(note.path).toLowerCase(), note);
    addName(withoutNoteExtension(fileNameOf(note.path)), note);
    addName(note.title, note);
    note.aliases.forEach((alias) => addName(alias, note));
  }

  return (fromPath: string, rawTarget: string): string | null => {
    const target = withoutNoteExtension(rawTarget.split("#")[0]!.trim()).toLowerCase();
    if (!target) return null;
    if (target.includes("/")) {
      const relative = normalizePath(`${directoryOf(fromPath).toLowerCase()}/${target}`);
      const absolute = normalizePath(target);
      const found =
        (relative !== null ? byPath.get(relative) : undefined) ??
        (absolute !== null ? byPath.get(absolute) : undefined);
      return found?.id ?? null;
    }
    const candidates = byName.get(target) ?? [];
    const sameFolder = candidates.find(
      (candidate) => directoryOf(candidate.path) === directoryOf(fromPath),
    );
    return (sameFolder ?? candidates[0])?.id ?? null;
  };
};

/** Where an imported diagram's top-left node lands, clear of the tab strip at the default zoom. */
const IMPORTED_GRAPH_ORIGIN = { x: 80, y: 120 };

/** Canvas files can sit anywhere on an infinite plane; keep the layout but start it in view. */
const moveIntoView = (graph: ReturnType<typeof parseNoteGraphJsonCanvas>) => {
  if (graph.nodes.length === 0) return graph;
  const minX = Math.min(...graph.nodes.map((node) => node.position.x));
  const minY = Math.min(...graph.nodes.map((node) => node.position.y));
  const dx = IMPORTED_GRAPH_ORIGIN.x - minX;
  const dy = IMPORTED_GRAPH_ORIGIN.y - minY;
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      position: { x: node.position.x + dx, y: node.position.y + dy },
    })),
  };
};

/**
 * Converts a Markdown folder or Obsidian vault into Loam notes: one note per
 * `.md` file, `.canvas` files as diagram notes, `[[wikilinks]]` and relative
 * links as note links, and local images copied into Loam.
 */
export async function convertMarkdownImport({
  files,
  createId,
  parseMarkdown,
  saveImages,
  onProgress,
}: MarkdownImportInput): Promise<ImportConverterOutput> {
  const { notes: planned, skipped } = planNotes(files, createId);
  const step = createImportProgress(planned.length, onProgress);
  const resolveNote = createNoteResolver(planned);

  const parsed = new Map<string, unknown[]>();
  const notes: BridgeImportNote[] = [];
  const kept: PlannedNote[] = [];
  for (const note of planned) {
    await step();
    if (note.format === "canvas") {
      try {
        const graph = moveIntoView(parseNoteGraphJsonCanvas(note.body));
        const tabId = createId();
        notes.push({
          id: note.id,
          title: note.title,
          folder: note.folder,
          tabs: [{ id: tabId, title: "Diagram", kind: "graph" }],
          blocksByTab: { [tabId]: [] },
          graphsByTab: { [tabId]: { enabled: true, ...graph } },
          activeTabId: tabId,
        });
      } catch {
        skipped.push({ path: note.path, reason: "Not a valid canvas file" });
      }
      continue;
    }
    try {
      parsed.set(note.id, await parseMarkdown(note.body));
      kept.push(note);
    } catch {
      skipped.push({ path: note.path, reason: "Could not read the Markdown" });
    }
  }

  const imageFor = await copyReferencedImages(
    kept.map((note) => ({ path: note.path, blocks: parsed.get(note.id)! })),
    saveImages,
    skipped,
  );

  for (const note of kept) {
    const blocks = resolveImportedBlocks(parsed.get(note.id)!, {
      resolveNote: (target) => resolveNote(note.path, target),
      resolveRelative: (path) =>
        MARKDOWN_FILE_PATTERN.test(path) ? resolveNote(note.path, path) : null,
      resolveImage: imageFor(note.path),
      videoId: note.video?.videoId,
    });
    notes.push(textNote({ ...note, tabId: createId(), blocks }));
  }

  const order = new Map(planned.map((note, index) => [note.id, index]));
  notes.sort((left, right) => order.get(left.id)! - order.get(right.id)!);
  return { notes, skipped };
}

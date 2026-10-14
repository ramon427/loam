// Markdown and in-app exports use the same JSON Canvas conversion.
import { buildNoteGraphJsonCanvas } from "../canvas/noteGraphJsonCanvas";
import {
  tabKindOf,
  type NoteDocument,
  type NoteFolder,
  type NoteGraph,
  type NoteProject,
  type NoteTab,
  type NoteTabKind,
} from "@loam/shared/notes/noteModel";
import { readMediaFileName } from "@loam/shared/notes/mediaFiles";

import { renderBlocks, type BlocksToMarkdownContext } from "../markdown/blocksToMarkdown";
import { buildFrontMatter } from "../markdown/frontMatter";
import { encodeLinkDestination, escapeMarkdownText } from "../markdown/inlineMarkdown";
import { buildNoteGraphMermaid } from "../markdown/noteGraphMermaid";
import { buildNoteTableMarkdown } from "../markdown/noteTableMarkdown";
import { createUniqueNamer, toSafeFileName } from "./exportFileNames";

const MARKDOWN_EXPORT_ATTACHMENTS_DIRECTORY = "attachments";

/** One file to create. Paths use `/` and are relative to the export folder. */
export type MarkdownExportFile =
  | { kind: "text"; path: string; content: string }
  | { kind: "media"; path: string; mediaFile: string };

export type MarkdownExportPlan = { files: MarkdownExportFile[]; noteCount: number };

type PlannedNote = {
  note: NoteDocument;
  directory: string;
  baseName: string;
  /** What `[[...]]` links use: the bare name when unique, otherwise its directory path. */
  linkTarget: string;
};

const joinPath = (directory: string, name: string) => (directory ? `${directory}/${name}` : name);

/** The way from a directory back up to the export folder. */
const toRoot = (directory: string) => (directory ? "../".repeat(directory.split("/").length) : "");

const byPosition = <T extends { position: number }>(items: readonly T[]) =>
  [...items].sort((left, right) => left.position - right.position);

const orderedTabs = (note: NoteDocument): NoteTab[] =>
  [...note.tabs].sort((left, right) => (left.position ?? 0) - (right.position ?? 0));

/** Notes created before graph tabs kept one diagram on the note itself. */
const legacyGraph = (note: NoteDocument): NoteGraph | null =>
  note.graph?.enabled &&
  note.graph.nodes.length > 0 &&
  !note.tabs.some((tab) => tab.kind === "graph")
    ? note.graph
    : null;

/**
 * Turns the whole library into Markdown files, `.canvas` diagrams and copied
 * images, laid out like an Obsidian vault. Pure: the caller writes the files.
 * Each project is a directory holding its folders and the notes outside them.
 */
export function buildMarkdownExport({
  notes,
  folders,
  projects = [],
  linkableNotes = [],
}: {
  notes: NoteDocument[];
  folders: NoteFolder[];
  projects?: NoteProject[];
  /**
   * Notes outside this export that links may still point at, for exporting a
   * single note. They are linked by their file name, as a full export would.
   */
  linkableNotes?: Array<{ id: string; title: string }>;
}): MarkdownExportPlan {
  const rootNames = createUniqueNamer();
  // Reserved first, so a user folder named "attachments" becomes "attachments (2)".
  rootNames(MARKDOWN_EXPORT_ATTACHMENTS_DIRECTORY, "/");
  // Names are unique per directory: a project's folders and notes share one namer.
  const namersByDirectory = new Map<string, ReturnType<typeof createUniqueNamer>>();
  const namerFor = (directory: string) => {
    const existing = namersByDirectory.get(directory);
    if (existing) return existing;
    const namer = directory ? createUniqueNamer() : rootNames;
    namersByDirectory.set(directory, namer);
    return namer;
  };
  const directoryByProjectId = new Map<string, string>();
  for (const project of byPosition(projects)) {
    directoryByProjectId.set(project.id, rootNames(toSafeFileName(project.name, "Project"), "/"));
  }
  const projectDirectory = (projectId: string | undefined) =>
    (projectId && directoryByProjectId.get(projectId)) || "";
  const directoryByFolderId = new Map<string, string>();
  for (const folder of byPosition(folders)) {
    const parent = projectDirectory(folder.projectId);
    const name = namerFor(parent)(toSafeFileName(folder.name, "Folder"), "/");
    directoryByFolderId.set(folder.id, joinPath(parent, name));
  }

  const planned: PlannedNote[] = notes.map((note) => {
    const directory =
      (note.folderId && directoryByFolderId.get(note.folderId)) || projectDirectory(note.projectId);
    const baseName = namerFor(directory)(toSafeFileName(note.title), ".md");
    return { note, directory, baseName, linkTarget: baseName };
  });
  const nameCounts = new Map<string, number>();
  for (const entry of planned) {
    const key = entry.baseName.toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  for (const entry of planned) {
    if ((nameCounts.get(entry.baseName.toLowerCase()) ?? 0) > 1) {
      entry.linkTarget = joinPath(entry.directory, entry.baseName);
    }
  }
  const plannedById = new Map(planned.map((entry) => [entry.note.id.toLowerCase(), entry]));
  const linkableById = new Map(linkableNotes.map((note) => [note.id.toLowerCase(), note.title]));

  const files: MarkdownExportFile[] = [];
  const mediaFiles = new Set<string>();
  const attachmentPath = (mediaFile: string) => {
    mediaFiles.add(mediaFile);
    return `${MARKDOWN_EXPORT_ATTACHMENTS_DIRECTORY}/${mediaFile}`;
  };

  for (const entry of planned) {
    const { note, directory, baseName } = entry;
    const videoId = note.video?.videoId;
    const context: BlocksToMarkdownContext = {
      noteTarget: (noteId) => {
        const target = plannedById.get(noteId);
        if (target) return { target: target.linkTarget, title: target.note.title };
        const title = linkableById.get(noteId);
        return title === undefined ? null : { target: toSafeFileName(title), title };
      },
      videoUrlAt: (seconds) =>
        videoId ? `https://www.youtube.com/watch?v=${videoId}&t=${seconds}s` : null,
      imagePath: (reference) => {
        const mediaFile = readMediaFileName(reference);
        if (!mediaFile) return null;
        return `${toRoot(directory)}${attachmentPath(mediaFile)}`;
      },
    };

    /** An embed tab: its image, copied with the export, or a link to its page. */
    const renderEmbed = (url: string) => {
      const image = context.imagePath(url);
      if (image) return `![](${encodeLinkDestination(image)})`;
      return /^https:\/\//i.test(url)
        ? `[${escapeMarkdownText(url)}](${encodeLinkDestination(url)})`
        : "";
    };

    const renderGraph = (graph: NoteGraph, tabTitle: string) => {
      const canvasName = namerFor(directory)(
        toSafeFileName(`${baseName} - ${tabTitle}`, baseName),
        ".canvas",
      );
      // Canvas file references are relative to the vault root.
      const nodes = graph.nodes.map((node) => {
        const mediaFile = node.imageUrl ? readMediaFileName(node.imageUrl) : null;
        return mediaFile ? { ...node, imageUrl: attachmentPath(mediaFile) } : node;
      });
      files.push({
        kind: "text",
        path: joinPath(directory, `${canvasName}.canvas`),
        content: buildNoteGraphJsonCanvas({ nodes, edges: graph.edges }),
      });
      return [
        "```mermaid",
        buildNoteGraphMermaid(graph),
        "```",
        "",
        `Full diagram: [[${joinPath(directory, `${canvasName}.canvas`)}]]`,
      ].join("\n");
    };

    const sections: Array<{ title: string; body: string; kind?: NoteTabKind }> = [];
    for (const tab of orderedTabs(note)) {
      const kind = tabKindOf(tab);
      let body = "";
      if (kind === "page") body = renderBlocks(note.blocksByTab[tab.id], context);
      if (kind === "embed") body = renderEmbed(note.embedsByTab?.[tab.id]?.url ?? "");
      const file = note.filesByTab?.[tab.id];
      // A Markdown tab's text is Markdown already; other files are named, not copied out.
      if (file?.source.kind === "text") body = file.source.text;
      else if (file) body = `File: ${escapeMarkdownText(file.name)}`;
      if (kind === "table" || kind === "board") {
        const table = note.tablesByTab?.[tab.id];
        body = table ? buildNoteTableMarkdown(table) : "";
      }
      if (kind === "graph") {
        const graph = note.graphsByTab?.[tab.id];
        body = graph?.nodes.length ? renderGraph(graph, tab.title || "Diagram") : "";
      }
      sections.push({ title: tab.title || "Untitled tab", body, kind });
    }
    const oldGraph = legacyGraph(note);
    if (oldGraph) sections.push({ title: "Diagram", body: renderGraph(oldGraph, "Diagram") });

    // A single page tab is the note itself; several tabs each get a heading.
    const onlyPage = sections.length === 1 && sections[0]!.kind === "page";
    const body = onlyPage
      ? sections[0]!.body
      : sections
          .map(({ title, body: sectionBody }) =>
            [`# ${escapeMarkdownText(title)}`, sectionBody].filter(Boolean).join("\n\n"),
          )
          .join("\n\n");

    const videoUrl =
      note.video?.url && /^https:\/\//i.test(note.video.url) ? note.video.url : undefined;
    const videoLine = videoUrl
      ? `Video: [${escapeMarkdownText(note.video?.title || videoUrl)}](${encodeLinkDestination(videoUrl)})`
      : "";
    const frontMatter = buildFrontMatter({
      title: note.title,
      "loam-id": note.id,
      updated: note.updatedAt,
      video: videoUrl,
    });
    const content = [videoLine, body].filter(Boolean).join("\n\n");
    files.push({
      kind: "text",
      path: joinPath(directory, `${baseName}.md`),
      content: `${frontMatter}\n${content}\n`,
    });
  }

  for (const mediaFile of [...mediaFiles].sort()) {
    files.push({
      kind: "media",
      path: `${MARKDOWN_EXPORT_ATTACHMENTS_DIRECTORY}/${mediaFile}`,
      mediaFile,
    });
  }
  return { files, noteCount: notes.length };
}

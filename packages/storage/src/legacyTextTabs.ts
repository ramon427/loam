import type { NoteContent, NoteGraph } from "@loam/shared/notes/noteModel";

/** How wide a former Text tab's text stands on its graph. */
const TEXT_WIDTH = 640;
/** About how many characters fit on a line of that width, and how tall a line is. */
const CHARACTERS_PER_LINE = 90;
const LINE_HEIGHT = 16;

/** A graph holding `text` as one text object, tall enough to show it all. */
const graphOfText = (text: string, tabId: string): NoteGraph => {
  const lines = text
    .split("\n")
    .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / CHARACTERS_PER_LINE)), 0);
  return {
    enabled: true,
    nodes: text.trim()
      ? [
          {
            id: `${tabId}-text`,
            title: "Text",
            notes: text.trim(),
            shape: "text",
            color: "gray",
            size: { width: TEXT_WIDTH, height: Math.ceil((lines * LINE_HEIGHT + 16) / 16) * 16 },
            position: { x: 0, y: 0 },
          },
        ]
      : [],
    edges: [],
  };
};

type TextTabsContent = Pick<NoteContent, "graphsByTab" | "textsByTab" | "filesByTab"> & {
  tabs?: readonly { id: string; kind?: string | null }[];
};

/**
 * Text tabs became graphs. Older versions saved them with the kind
 * "markdown", which Markdown file tabs have now: a file tab has its file in
 * `filesByTab`, a Text tab has none. Each Text tab becomes a graph tab, and
 * one without a graph yet gets one holding its Markdown as a text object.
 * The Markdown stays in `textsByTab`, so older versions still read it, and a
 * graph made here is saved with the note's next change. Pass the note's
 * `files` when `content` is a save that doesn't name them.
 */
export const upgradeTextTabs = <T extends TextTabsContent>(
  content: T,
  files = content.filesByTab,
): T => {
  const textTabIds = new Set(
    (content.tabs ?? []).flatMap((tab) =>
      tab.kind === "markdown" && !files?.[tab.id] ? [tab.id] : [],
    ),
  );
  if (textTabIds.size === 0) return content;
  const withoutGraph = [...textTabIds].filter((id) => !content.graphsByTab?.[id]);
  return {
    ...content,
    tabs: content.tabs!.map((tab) => (textTabIds.has(tab.id) ? { ...tab, kind: "graph" } : tab)),
    graphsByTab: {
      ...content.graphsByTab,
      ...Object.fromEntries(
        withoutGraph.map((id) => [id, graphOfText(content.textsByTab?.[id] ?? "", id)]),
      ),
    },
  };
};

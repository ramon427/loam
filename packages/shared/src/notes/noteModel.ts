/**
 * Tabs that hold what the note makes: a page of blocks, a graph (shapes,
 * connections and text anywhere on a canvas), a table, which a board shows
 * as cards, or a web page or image to embed. A tab can change between these,
 * carrying its content over.
 */
export const CONVERTIBLE_TAB_KINDS = ["page", "graph", "table", "board", "embed"] as const;

export type ConvertibleTabKind = (typeof CONVERTIBLE_TAB_KINDS)[number];

/** Tabs that show a file: a PDF or Word document to read, or a Markdown file to edit. */
export const FILE_TAB_KINDS = ["pdf", "docx", "markdown"] as const;

export type FileTabKind = (typeof FILE_TAB_KINDS)[number];

export const NOTE_TAB_KINDS = [...CONVERTIBLE_TAB_KINDS, ...FILE_TAB_KINDS] as const;

export type NoteTabKind = (typeof NOTE_TAB_KINDS)[number];

/** The kind page tabs were saved with before they were called pages. */
export const LEGACY_PAGE_TAB_KIND = "text";

/** Backlinks tabs held nothing; notes drop them when read or saved. */
export const LEGACY_BACKLINKS_TAB_KIND = "backlinks";

const isNoteTabKind = (kind: unknown): kind is NoteTabKind =>
  NOTE_TAB_KINDS.includes(kind as NoteTabKind);

export type NoteTab = {
  id: string;
  title: string;
  kind?: NoteTabKind;
  position?: number;
};

/**
 * A tab's kind. Tabs saved before tabs had kinds, or as "text" tabs, are
 * pages. Older versions saved Text tabs as "markdown" too; the store turns
 * those into graphs as it reads them (see `upgradeTextTabs`), so a
 * "markdown" tab past the store is a Markdown file.
 */
export const tabKindOf = (tab: { kind?: string | null } | undefined): NoteTabKind => {
  const kind = tab?.kind;
  return isNoteTabKind(kind) ? kind : "page";
};

/** A tab's title as the app shows it; a tab without one is "Untitled". */
export const tabTitleOf = (tab: Pick<NoteTab, "title"> | undefined) =>
  tab?.title?.trim() || "Untitled";

/** What an embed tab shows: an https web page, or an image as page blocks store one. */
export type NoteEmbed = { url: string };

export const isFileTabKind = (kind: NoteTabKind): kind is FileTabKind =>
  FILE_TAB_KINDS.includes(kind as FileTabKind);

/**
 * Where a file tab's file is. An imported PDF or Word document was copied
 * into the media folder as `fileName`; a Markdown file the note holds is its
 * `text`. Both are backed up, synced and encrypted with the notes. A
 * referenced file stays at `path` on the computer `computerId` names; other
 * computers don't have it.
 */
type NoteFileSource =
  | { kind: "imported"; fileName: string }
  | { kind: "text"; text: string }
  | { kind: "referenced"; path: string; computerId: string };

/** What a file tab shows: a file, under the name it had when it was added. */
export type NoteFile = {
  name: string;
  source: NoteFileSource;
  /** The page a PDF was last read at, from 1. */
  page?: number;
};

/** The longest Markdown a note holds itself; a longer file stays linked. */
export const MAX_NOTE_MARKDOWN_LENGTH = 1_000_000;

export type NoteVideo = {
  url: string;
  videoId: string;
  title?: string;
  lastWatchedSeconds?: number;
};

export type NoteGraphNodeColor =
  "blue" | "green" | "purple" | "orange" | "red" | "yellow" | "pink" | "gray";

export type NoteGraphNodeShape =
  "process" | "terminator" | "decision" | "ellipse" | "sticky" | "text" | "image" | "frame";

export type NoteGraphNodeVariant = "filled" | "outline" | "ghost";

export type NoteGraphNodeSize = {
  width: number;
  height: number;
};

export type NoteGraphNode = {
  id: string;
  title: string;
  headingBlockIds?: string[];
  notes?: string;
  color?: NoteGraphNodeColor;
  /** Custom hex color override; wins over `color` when set. */
  colorHex?: string;
  shape?: NoteGraphNodeShape;
  variant?: NoteGraphNodeVariant;
  size?: NoteGraphNodeSize;
  /** Stored image path or local media URL for an optional node image. */
  imageUrl?: string;
  timestampSeconds?: number;
  /** Locked nodes cannot be dragged, resized, edited, or deleted. */
  locked?: boolean;
  /** Frame-only: children are hidden and the frame renders as a chip. */
  collapsed?: boolean;
  /** Frame-only: size to restore when a collapsed frame expands again. */
  expandedSize?: NoteGraphNodeSize;
  position: {
    x: number;
    y: number;
  };
};

export type NoteGraphEdgeType = "smoothstep" | "straight" | "bezier" | "step";

export type NoteGraphEdgeDirection = "none" | "end" | "start" | "both";

export type NoteGraphEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: NoteGraphEdgeType;
  direction?: NoteGraphEdgeDirection;
  color?: NoteGraphNodeColor;
  dashed?: boolean;
  /** Stroke width in px, 1-4. Default 1.8. */
  width?: number;
  /** Locked edges cannot be selected, reconnected, or deleted. */
  locked?: boolean;
};

type NoteGraphViewport = {
  x: number;
  y: number;
  zoom: number;
};

type NoteGraphGridMode = "dots" | "lines" | "off";

type NoteGraphTheme = "default" | "blueprint" | "warm";

export type NoteGraph = {
  enabled: boolean;
  nodes: NoteGraphNode[];
  edges: NoteGraphEdge[];
  viewport?: NoteGraphViewport;
  /** Canvas view preferences; intentionally outside undo history. */
  grid?: NoteGraphGridMode;
  snap?: boolean;
  scrollMode?: "zoom" | "pan";
  theme?: NoteGraphTheme;
};

/** A live, read-only window onto a fixed area of a graph, stored in a text block. */
export type NoteGraphSnapshot = {
  noteId: string;
  tabId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export const NOTE_TABLE_COLUMN_TYPES = ["text", "number", "boolean", "date", "select"] as const;

export type NoteTableColumnType = (typeof NOTE_TABLE_COLUMN_TYPES)[number];

type NoteTableSelectOption = {
  id: string;
  label: string;
};

export type NoteTableCellValue = string | number | boolean | null;

export type NoteTableColumn = {
  id: string;
  title: string;
  type: NoteTableColumnType;
  headingBlockIds?: string[];
  width?: number;
  position?: number;
  options?: NoteTableSelectOption[];
};

export type NoteTableRow = {
  id: string;
  headingBlockIds?: string[];
  position?: number;
  cells: Record<string, NoteTableCellValue>;
};

export type NoteTable = {
  columns: NoteTableColumn[];
  rows: NoteTableRow[];
  /** The select column a board tab sorts its cards into. */
  groupColumnId?: string;
};

/** What a note holds. Its row in the library adds where it sits and when it changed. */
export type NoteContent = {
  title: string;
  tabs: NoteTab[];
  blocksByTab: Record<string, unknown[]>;
  activeTabId: string;
  video?: NoteVideo;
  graphsByTab?: Record<string, NoteGraph>;
  tablesByTab?: Record<string, NoteTable>;
  /** Text tabs' Markdown, from before they were graphs; see `upgradeTextTabs`. */
  textsByTab?: Record<string, string>;
  embedsByTab?: Record<string, NoteEmbed>;
  filesByTab?: Record<string, NoteFile>;
  /** A graph from before graphs had their own tabs; kept so old notes lose nothing. */
  graph?: NoteGraph;
};

/** The map of a note's content that holds each kind of tab's content, by tab id, for kinds that store any. */
export const TAB_CONTENT_KEYS = {
  page: "blocksByTab",
  graph: "graphsByTab",
  table: "tablesByTab",
  board: "tablesByTab",
  embed: "embedsByTab",
  pdf: "filesByTab",
  docx: "filesByTab",
  markdown: "filesByTab",
} as const satisfies Partial<Record<NoteTabKind, keyof NoteContent>>;

/** The parts of a note's content a save changes; the rest stays as stored. `null` removes the video or legacy graph. */
export type NotePatch = Partial<Omit<NoteContent, "video" | "graph">> & {
  video?: NoteVideo | null;
  graph?: NoteGraph | null;
};

/**
 * A note to create; it goes at the end of its folder, or of its project's or the library's top
 * level. A folder decides the project; `projectId` places a note outside folders.
 */
export type NewNote = NoteContent & {
  id: string;
  folderId?: string | null;
  projectId?: string | null;
  /** Makes the note a sub-note of this one; it then has no folder or project of its own. */
  parentNoteId?: string | null;
};

export type NoteDocument = NoteContent & {
  /** A summary has only the title and placement; the editor loads the full note. */
  contentState?: "summary" | "full";
  id: string;
  updatedAt: string;
  folderId?: string;
  /** Set only on notes outside folders; a note in a folder is in that folder's project. */
  projectId?: string;
  /** Set only on sub-notes: the note this one sits inside, whose place it shares. */
  parentNoteId?: string;
  position?: number;
};

export type NoteFolder = {
  id: string;
  name: string;
  position: number;
  /** The project holding the folder; unset at the library's top level. */
  projectId?: string;
};

export type NoteProjectColor = NoteGraphNodeColor;

/** An emoji, or one of the app's line icons (see noteProjects.ts) in a palette color. */
export type NoteProjectIcon =
  { kind: "emoji"; value: string } | { kind: "symbol"; value: string; color?: NoteProjectColor };

/** A top-level group of folders and notes, with a name and an icon. */
export type NoteProject = {
  id: string;
  name: string;
  position: number;
  icon?: NoteProjectIcon;
};

/**
 * Every project, folder and note in library order, saved together when anything moves.
 * Positions come from the order. Leaving out `projects` keeps the stored ones; a project left
 * out of the list is removed, and what it held moves to the library's top level. Leaving out
 * an item's `projectId` keeps its project (none for a new folder). A note's `projectId` counts
 * only outside folders: a folder decides its notes' project. A note's `parentNoteId` makes it
 * a sub-note of that note, outside folders and projects; leaving it out keeps the note's
 * parent unless the note goes into a folder, and null takes the note out of its parent.
 */
export type NotesLayout = {
  projects?: Array<{ id: string; name: string; icon?: NoteProjectIcon }>;
  folders: Array<{ id: string; name: string; projectId?: string | null }>;
  notes: Array<{
    id: string;
    folderId: string | null;
    projectId?: string | null;
    parentNoteId?: string | null;
  }>;
};

export type NotesBootstrap = {
  notes: NoteDocument[];
  folders: NoteFolder[];
  projects: NoteProject[];
};

/** A note's saved versions, newest first; its current content is not one of them. */
export type NoteHistory = {
  versions: Array<{
    id: string;
    savedAt: number;
    title: string;
    sizeBytes: number;
    /** Lost to an edit made elsewhere at the same time. */
    conflict?: boolean;
  }>;
};

/** One saved version's full content. */
export type NoteVersion = { savedAt: number; note: NoteContent };

/**
 * A note two computers (or the user and an AI client) changed at once: the edit
 * that lost is kept in its history as `versionId`.
 */
export type NoteConflict = { noteId: string; versionId: string; title: string };

/**
 * A saved note's new `updatedAt`, and the conflict if the save replaced
 * content another device or an AI client had just written.
 */
export type SavedNote = { updatedAt: string; conflict?: NoteConflict };

/** What changed in the library, so a window showing it can catch up. */
export type NotesChange = {
  /** Notes created or whose content changed. */
  changedNoteIds: string[];
  deletedNoteIds: string[];
  /** Folders or the order of notes changed. */
  layoutChanged: boolean;
  /** Notes whose history now holds a version that lost a conflict. */
  conflicts: NoteConflict[];
};

/** A deleted note that can be restored without replacing the library. */
export type NoteTrashEntry = { id: string; title: string; deletedAt: number };

/** Another note whose saved body links to the note. */
type NoteBacklinkNote = {
  id: string;
  title: string;
  updatedAt: string;
};

/**
 * Other notes that link a note, newest first. The list is capped; the count is
 * the full total.
 */
export type NoteBacklinks = {
  notes: NoteBacklinkNote[];
  noteCount: number;
};

/**
 * One highlighted match window inside a content-search snippet. Offsets are
 * relative to `text`, measured in UTF-16 code units, so the UI can wrap the
 * matched range in a highlight without re-searching.
 */
type NoteContentSearchSnippet = {
  text: string;
  matchStart: number;
  matchLength: number;
};

export type NoteContentSearchResult = {
  noteId: string;
  title: string;
  updatedAt: string;
  folderId?: string;
  projectId?: string;
  snippet: NoteContentSearchSnippet;
  /** How many content matches the query produced inside this note. */
  matchCount: number;
  /** The tab containing the snippet's match, when the body matched. */
  tabId?: string;
  /** The query term to reveal; it may differ from a term matched only in the title. */
  matchText?: string;
};

export type NoteContentSearchResponse = {
  results: NoteContentSearchResult[];
  /** True when more notes matched than the requested result cap. */
  hasMore: boolean;
};

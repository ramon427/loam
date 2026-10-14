import {
  AppWindowIcon,
  FileCodeIcon,
  FileTextIcon,
  FileTypeIcon,
  GitBranchIcon,
  LayoutGridIcon,
  SquareKanbanIcon,
  type LucideIcon,
} from "lucide-react";

import {
  isFileTabKind,
  type ConvertibleTabKind,
  type NoteTabKind,
} from "@loam/shared/notes/noteModel";
import { NoteRouteIcon } from "../ui/NoteRouteIcon";

/** How the app names and shows a kind of tab. */
type TabKindInfo = {
  label: string;
  /** One line for the add-tab menu. */
  description: string;
  icon: LucideIcon | typeof NoteRouteIcon;
  group: TabKindGroup;
  /** What the tab says while its editor loads. */
  loadingLabel: string;
};

type TabKindGroup = "Write" | "Organize" | "Reference";

/** Every kind of tab, in the order the add-tab menu lists each group. */
export const TAB_KINDS: Record<NoteTabKind, TabKindInfo> = {
  page: {
    label: "Page",
    description: "Headings, lists and blocks",
    icon: NoteRouteIcon,
    group: "Write",
    loadingLabel: "Loading page",
  },
  table: {
    label: "Table",
    description: "Typed columns and rows",
    icon: LayoutGridIcon,
    group: "Organize",
    loadingLabel: "Loading table",
  },
  board: {
    label: "Board",
    description: "Cards in columns, such as to do and done",
    icon: SquareKanbanIcon,
    group: "Organize",
    loadingLabel: "Loading board",
  },
  graph: {
    label: "Graph",
    description: "Shapes, connections and text anywhere on a canvas",
    icon: GitBranchIcon,
    group: "Write",
    loadingLabel: "Loading diagram",
  },
  embed: {
    label: "Embed",
    description: "A web page or image, shown in the tab",
    icon: AppWindowIcon,
    group: "Reference",
    loadingLabel: "Loading embed",
  },
  markdown: {
    label: "Markdown",
    description: "A Markdown file, written as plain text",
    icon: FileCodeIcon,
    group: "Write",
    loadingLabel: "Loading Markdown",
  },
  pdf: {
    label: "PDF",
    description: "A PDF to read beside your notes",
    icon: FileTextIcon,
    group: "Reference",
    loadingLabel: "Loading PDF",
  },
  docx: {
    label: "Word",
    description: "A Word document to read",
    icon: FileTypeIcon,
    group: "Reference",
    loadingLabel: "Loading document",
  },
};

const GROUP_ORDER: readonly TabKindGroup[] = ["Write", "Organize", "Reference"];

/** Every kind in menu order, numbered from 1 for the add-tab menu's number keys. */
export const TAB_KIND_ORDER: readonly NoteTabKind[] = GROUP_ORDER.flatMap((group) =>
  (Object.keys(TAB_KINDS) as NoteTabKind[]).filter((kind) => TAB_KINDS[kind].group === group),
);

/** The kinds a tab can change to, in menu order; a file tab always shows its file. */
export const CHANGE_TYPE_KINDS = TAB_KIND_ORDER.filter(
  (kind): kind is ConvertibleTabKind => !isFileTabKind(kind),
);

/** The kinds grouped as the add-tab menu lists them. */
export const TAB_KIND_GROUPS = GROUP_ORDER.map((group) => ({
  group,
  kinds: TAB_KIND_ORDER.filter((kind) => TAB_KINDS[kind].group === group),
}));

export function TabKindIcon({ kind }: { kind: NoteTabKind }) {
  const Icon = TAB_KINDS[kind].icon;
  return <Icon aria-hidden="true" className="size-3.5" />;
}

/**
 * A new tab's title: the kind's name, numbered when the note already has a
 * tab of that name ("Table", "Table 2").
 */
export const defaultTabTitle = (kind: NoteTabKind, titles: readonly string[]) => {
  const label = TAB_KINDS[kind].label;
  const taken = new Set(titles.map((title) => title.trim()));
  if (!taken.has(label)) return label;
  let number = 2;
  while (taken.has(`${label} ${number}`)) number += 1;
  return `${label} ${number}`;
};

/** Whether `title` is one `defaultTabTitle` gives a tab of `kind`, or none at all. */
export const isDefaultTabTitle = (kind: NoteTabKind, title: string) => {
  const trimmed = title.trim();
  const label = TAB_KINDS[kind].label;
  return trimmed === "" || trimmed === label || new RegExp(`^${label} \\d+$`).test(trimmed);
};

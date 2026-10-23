import type { Dictionary } from "@blocknote/core";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import type { EditorState } from "@tiptap/pm/state";

import { readPreference, writePreference } from "../lib/preferences";
import type { BlockPreviewKind } from "./blocknote/blockTypePreviewModel";

type SlashMenuSection =
  "Recent" | "Basic blocks" | "Lists" | "Media" | "Layout" | "Advanced" | "Notes" | "Plugins";

/**
 * Every slash command notes offer, by key: its section and the sample its
 * preview shows. BlockNote's other commands make blocks notes don't offer:
 * code blocks, headings below level 3, and video, audio and file blocks, since
 * notes keep only images. The schema still reads those blocks, so notes that
 * hold them open.
 */
const slashCommands = {
  heading: { section: "Basic blocks", preview: "heading-1" },
  heading_2: { section: "Basic blocks", preview: "heading-2" },
  heading_3: { section: "Basic blocks", preview: "heading-3" },
  paragraph: { section: "Basic blocks", preview: "paragraph" },
  quote: { section: "Basic blocks", preview: "quote" },
  divider: { section: "Basic blocks", preview: "divider" },
  numbered_list: { section: "Lists", preview: "numberedListItem" },
  bullet_list: { section: "Lists", preview: "bulletListItem" },
  check_list: { section: "Lists", preview: "checkListItem" },
  toggle_list: { section: "Lists", preview: "toggleListItem" },
  image: { section: "Media", preview: "image" },
  table: { section: "Layout", preview: "table" },
  columns_2: { section: "Layout", preview: "columns-2" },
  columns_3: { section: "Layout", preview: "columns-3" },
  toggle_heading: { section: "Advanced", preview: "toggle-heading-1" },
  toggle_heading_2: { section: "Advanced", preview: "toggle-heading-2" },
  toggle_heading_3: { section: "Advanced", preview: "toggle-heading-3" },
  emoji: { section: "Advanced", preview: "emoji" },
  note_link: { section: "Notes", preview: "generic" },
} satisfies Record<string, { section: SlashMenuSection; preview: BlockPreviewKind }>;

/** Plugins' items are keyed `plugin:<plugin id>.<item id>` and share one section. */
type SlashCommandKey = keyof typeof slashCommands | `plugin:${string}`;

/** A slash command; `key` names it for its section, preview and recent use. */
export type SlashCommand = DefaultReactSuggestionItem & { key: SlashCommandKey };

const PLUGIN_SLASH_COMMAND = { section: "Plugins", preview: "generic" } as const;

const describeCommand = (key: SlashCommandKey) =>
  key.startsWith("plugin:")
    ? PLUGIN_SLASH_COMMAND
    : slashCommands[key as keyof typeof slashCommands];

export const isSlashCommandKey = (key: string): key is keyof typeof slashCommands =>
  key in slashCommands;

/**
 * The formatting toolbar's block types that notes offer: those with a slash
 * command. BlockNote names each one by its slash command's dictionary title.
 */
export const offeredBlockTypeItems = <Item extends { name: string }>(
  items: readonly Item[],
  dictionary: Dictionary,
) => {
  const titles: Partial<Record<string, { title: string }>> = dictionary.slash_menu;
  const offered = new Set(Object.keys(slashCommands).map((key) => titles[key]?.title));
  return items.filter((item) => offered.has(item.name));
};

export type SlashMenuItem = SlashCommand & {
  section: SlashMenuSection;
  preview: BlockPreviewKind;
  score: number;
  isRecent?: boolean;
};

const sectionOrder: SlashMenuSection[] = [
  "Recent",
  "Basic blocks",
  "Lists",
  "Media",
  "Layout",
  "Advanced",
  "Notes",
  "Plugins",
];

const RECENT_COMMANDS_KEY = "slash-menu-recents";
const MAX_RECENT_COMMANDS = 5;

// Clicking outside closes the menu, but the same pointer gesture can make
// BlockNote ask for items again; the guard keeps it closed for that moment.
let closeGuardUntil = 0;

export function setSlashMenuCloseGuard(durationMs = 160) {
  closeGuardUntil = Date.now() + durationMs;
}

export function isSlashMenuCloseGuardActive() {
  return Date.now() < closeGuardUntil;
}

// Commands in the section matching the cursor's block rank a little higher.
const sectionByContextBlock: Record<string, SlashMenuSection> = {
  bulletListItem: "Lists",
  numberedListItem: "Lists",
  checkListItem: "Lists",
  toggleListItem: "Lists",
  column: "Layout",
  columnList: "Layout",
};

export function loadRecentSlashMenuIds() {
  return (
    readPreference(
      RECENT_COMMANDS_KEY,
      (value) =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === "string")
          : null,
      "everywhere",
    ) ?? []
  );
}

export function trackRecentSlashMenuItem(id: string) {
  const next = [id, ...loadRecentSlashMenuIds().filter((item) => item !== id)].slice(
    0,
    MAX_RECENT_COMMANDS,
  );
  writePreference(RECENT_COMMANDS_KEY, next, "everywhere");
}

/**
 * The slash menu's rows for a query: matching commands, best first within each
 * section. With nothing typed, recently used ones are lifted into "Recent".
 */
export function buildSlashMenuItems({
  items,
  query,
  contextBlockType,
  recentIds = [],
}: {
  items: readonly SlashCommand[];
  query: string;
  contextBlockType?: string;
  recentIds?: readonly string[];
}): SlashMenuItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const contextSection = contextBlockType ? sectionByContextBlock[contextBlockType] : undefined;
  const recent = new Set(recentIds);

  const scored = items.flatMap((item) => {
    const score = scoreItem(item, normalizedQuery);
    if (score === null) return [];
    const { section, preview } = describeCommand(item.key);
    const isRecent = recent.has(item.key);
    const bonus = (isRecent ? 32 : 0) + (contextSection === section ? 16 : 0);
    return [{ ...item, section, preview, score: score + bonus, isRecent }];
  });

  const byScore = (a: SlashMenuItem, b: SlashMenuItem) =>
    b.score - a.score || a.title.localeCompare(b.title);
  const recentItems = normalizedQuery ? [] : scored.filter((item) => item.isRecent).sort(byScore);
  const recentKeys = new Set(recentItems.map((item) => item.key));
  const rest = scored.filter((item) => !recentKeys.has(item.key)).sort(byScore);
  const bestScore = (section: SlashMenuSection) =>
    rest.find((item) => item.section === section)?.score ?? -1;
  // Once a query is typed, the section holding the best match comes first, so
  // Enter picks it rather than a weaker match in an earlier section.
  const sections = normalizedQuery
    ? sectionOrder.toSorted((a, b) => bestScore(b) - bestScore(a))
    : sectionOrder;

  return [
    ...recentItems.map((item) => ({ ...item, section: "Recent" as const })),
    ...sections.flatMap((section) => rest.filter((item) => item.section === section)),
  ];
}

/**
 * Whether the "/" being typed starts a command: at the start of a block or
 * after whitespace, so "and/or" or a URL doesn't open the menu.
 */
export function isValidSlashTrigger(state: EditorState) {
  const { $from } = state.selection;
  if (!$from.parent.isTextblock) return true;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, "\n", "\n");
  const slashIndex = textBefore.lastIndexOf("/");
  // BlockNote can remove the trigger slash while an active suggestion query keeps updating.
  if (slashIndex <= 0) return true;
  return /\s/.test(textBefore[slashIndex - 1] ?? "");
}

/**
 * A slash query starting with a space closes the menu: the "/" was meant as
 * text, and Enter would otherwise insert the first command.
 */
export const isSlashQueryAbandoned = (query: string) => /^\s/.test(query);

/**
 * How well a command matches the query: its title or an alias starting with
 * or containing the query, then holding the query's letters in order, then its
 * description containing the query. Descriptions get no letters-in-order
 * match, as a sentence holds almost any short query's letters.
 */
function scoreItem(item: SlashCommand, query: string) {
  if (!query) return 0;
  let best: number | null = null;
  for (const target of [item.title, ...(item.aliases ?? [])]) {
    const value = target.toLowerCase();
    let score: number | null = null;
    if (value.startsWith(query)) score = 100;
    else if (value.includes(query)) score = 80;
    else {
      const fuzzy = fuzzyMatchScore(value, query);
      if (fuzzy !== null) score = Math.min(79, 50 + fuzzy);
    }
    if (score !== null) best = Math.max(best ?? 0, score);
  }
  if (best === null && item.subtext?.toLowerCase().includes(query)) best = 40;
  return best;
}

/** Scores the query's letters appearing in order, more for consecutive runs. */
function fuzzyMatchScore(target: string, query: string) {
  let score = 0;
  let lastIndex = -1;
  let consecutive = 0;
  for (const char of query) {
    const nextIndex = target.indexOf(char, lastIndex + 1);
    if (nextIndex === -1) return null;
    if (nextIndex === lastIndex + 1) {
      consecutive += 1;
      score += 4 + consecutive;
    } else {
      consecutive = 0;
      score += 2;
    }
    lastIndex = nextIndex;
  }
  return score;
}

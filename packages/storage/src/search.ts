/**
 * Search: what a note's body says as plain text, finding a term in it, and
 * ranking notes when the backend has no text index.
 *
 * Page tabs are stored as BlockNote JSON. The search reads them as plain
 * text: inline `content` items contribute their text, nested `children`
 * blocks are walked recursively, and blocks are joined with newlines so
 * snippets read like the document outline.
 */

import {
  tabKindOf,
  type NoteContent,
  type NoteContentSearchResult,
  type NoteTab,
} from "@loam/shared/notes/noteModel";
import { isRecord } from "@loam/shared/utils/isRecord";

import type { NoteRow } from "./noteContent";

const SNIPPET_PREFIX_LENGTH = 40;
const SNIPPET_SUFFIX_LENGTH = 80;
const MAX_EXTRACTED_TEXT_LENGTH = 200_000;

const readInlineText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (isRecord(item) && typeof item.text === "string") return item.text;
      return "";
    })
    .join("");
};

const appendBlockText = (block: unknown, sink: string[]): void => {
  if (!isRecord(block)) return;
  const text = readInlineText(block.content).trim();
  if (text) sink.push(text);
  if (Array.isArray(block.children)) {
    for (const child of block.children) {
      appendBlockText(child, sink);
    }
  }
};

/** Extracts searchable plain text from a BlockNote blocks array. */
const extractNoteBlocksText = (blocks: unknown): string => {
  if (!Array.isArray(blocks)) return "";
  const sink: string[] = [];
  for (const block of blocks) {
    appendBlockText(block, sink);
  }
  const text = sink.join("\n");
  return text.length > MAX_EXTRACTED_TEXT_LENGTH ? text.slice(0, MAX_EXTRACTED_TEXT_LENGTH) : text;
};

/** Lower case without accents, so "cafe" finds "Café", as the SQLite index compares text. */
const foldForSearch = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** A match of a search term, as [start, end) offsets in the original text. */
type NoteContentMatch = { start: number; end: number };

const NON_ASCII = /[^\u0000-\u007f]/;

/** Where each non-overlapping `needle` starts in `haystack`. */
const indexesOf = (haystack: string, needle: string) => {
  const found: number[] = [];
  for (
    let at = haystack.indexOf(needle);
    at !== -1;
    at = haystack.indexOf(needle, at + needle.length)
  )
    found.push(at);
  return found;
};

/**
 * Every non-overlapping match of `term` in `text`, ignoring case and accents.
 * Matching runs on the folded text; each folded character remembers the
 * original character it came from, so a match can be shown in `text` itself.
 */
const findNoteContentMatches = (text: string, term: string): NoteContentMatch[] => {
  const needle = foldForSearch(term);
  if (!text || !needle) return [];
  // ASCII folds by lower-casing alone, which keeps every offset, so most
  // notes skip normalizing their text one character at a time.
  if (!NON_ASCII.test(text))
    return indexesOf(text.toLowerCase(), needle).map((at) => ({
      start: at,
      end: at + needle.length,
    }));
  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;
  for (const character of text) {
    const piece = NON_ASCII.test(character) ? foldForSearch(character) : character.toLowerCase();
    // A separate accent mark folds to nothing; the character before it covers it.
    if (!piece && ends.length > 0) ends[ends.length - 1] = index + character.length;
    for (let unit = 0; unit < piece.length; unit += 1) {
      starts.push(index);
      ends.push(index + character.length);
    }
    folded += piece;
    index += character.length;
  }
  return indexesOf(folded, needle).map((at) => ({
    start: starts[at]!,
    end: ends[at + needle.length - 1]!,
  }));
};

/** The text a page tab holds, or a Markdown tab whose text the note holds; other tabs hold none. */
export const extractTabText = (note: NoteContent, tab: NoteTab): string => {
  const kind = tabKindOf(tab);
  if (kind === "page") return extractNoteBlocksText(note.blocksByTab[tab.id]);
  const source = note.filesByTab?.[tab.id]?.source;
  if (kind === "markdown" && source?.kind === "text") return source.text;
  return "";
};

/** The first tab whose text holds `term`, in tab order, so opening a hit reveals its match. */
const findNoteContentMatchTab = (note: NoteContent, term: string): string | undefined => {
  const needle = foldForSearch(term);
  if (!needle) return undefined;
  return note.tabs.find((tab) => foldForSearch(extractTabText(note, tab)).includes(needle))?.id;
};

type NoteContentSnippetWindow = {
  text: string;
  matchStart: number;
  matchLength: number;
};

/**
 * A bounded snippet around `match`. Offsets stay valid for the returned
 * window, so the UI can highlight the match without searching again.
 */
const buildNoteContentSnippet = (
  text: string,
  match: NoteContentMatch,
): NoteContentSnippetWindow => {
  const matchLength = match.end - match.start;
  const rawStart = Math.max(0, match.start - SNIPPET_PREFIX_LENGTH);
  const rawEnd = Math.min(text.length, match.end + SNIPPET_SUFFIX_LENGTH);
  let snippetStart = rawStart;
  let snippetEnd = rawEnd;

  if (snippetStart > 0) {
    const nextSpace = text.indexOf(" ", snippetStart);
    if (nextSpace !== -1 && nextSpace < match.start) snippetStart = nextSpace + 1;
  }
  if (snippetEnd < text.length) {
    const previousSpace = text.lastIndexOf(" ", snippetEnd);
    if (previousSpace > match.end) snippetEnd = previousSpace;
  }

  const prefix = snippetStart > 0 ? "… " : "";
  const suffix = snippetEnd < text.length ? " …" : "";
  return {
    text: `${prefix}${text.slice(snippetStart, snippetEnd)}${suffix}`,
    matchStart: prefix.length + (match.start - snippetStart),
    matchLength,
  };
};

/**
 * Search without the backend's text index (an encrypted store, or one with
 * none): notes holding every word, title matches first, then newest first.
 * `folded` keeps each row's folded text; a saved row is a new object.
 */
export const scanNoteRows = (
  rows: Iterable<NoteRow>,
  query: string,
  folded: WeakMap<NoteRow, string>,
) => {
  const terms = foldForSearch(query).split(/\s+/).filter(Boolean);
  const matches: Array<{ row: NoteRow; inTitle: boolean }> = [];
  for (const row of rows) {
    let text = folded.get(row);
    if (text === undefined) {
      text = foldForSearch(`${row.title}\n${row.text}`);
      folded.set(row, text);
    }
    if (!terms.every((term) => text.includes(term))) continue;
    const title = text.slice(0, text.indexOf("\n"));
    matches.push({ row, inTitle: terms.every((term) => title.includes(term)) });
  }
  return matches
    .sort(
      (left, right) =>
        Number(right.inTitle) - Number(left.inTitle) ||
        right.row.updatedAt.localeCompare(left.row.updatedAt) ||
        left.row.id.localeCompare(right.row.id),
    )
    .map((match) => match.row);
};

/**
 * A note that matched `query`, shown around the first of its words the body
 * holds. `content` finds the tab to open; without it no tab is named.
 */
export const toSearchResult = (
  row: NoteRow,
  query: string,
  content: NoteContent | null,
): NoteContentSearchResult => {
  const terms = query.split(/\s+/);
  const bodyText = foldForSearch(row.text);
  const term = terms.find((candidate) => bodyText.includes(foldForSearch(candidate))) ?? terms[0]!;
  const matches = findNoteContentMatches(row.text, term);
  return {
    noteId: row.id,
    title: row.title,
    updatedAt: row.updatedAt,
    folderId: row.folderId ?? undefined,
    projectId: row.projectId,
    snippet: matches[0]
      ? buildNoteContentSnippet(row.text, matches[0])
      : { text: row.text.slice(0, 120), matchStart: 0, matchLength: 0 },
    matchCount: matches.length,
    matchText: term,
    tabId: content ? findNoteContentMatchTab(content, term) : undefined,
  };
};

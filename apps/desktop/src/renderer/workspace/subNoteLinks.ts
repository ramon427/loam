import { tabKindOf } from "@loam/shared/notes/noteModel";
import { buildNoteHref } from "@loam/shared/notes/noteLinks";
import { isRecord } from "@loam/shared/utils/isRecord";
import { createUuid } from "@loam/shared/utils/uuid";

import { readNoteLinkNoteId } from "../editor/editorLinks";
import { getNoteLinkTitle } from "../editor/noteMentions";
import type { NotePartialBlock } from "../editor/noteEditorSchema";
import type { NoteDocument } from "./types";

/*
 * A sub-note made from the sidebar is linked from its parent, as Notion's
 * pages are. The link is an ordinary note link: it stays in the parent when
 * the sub-note moves out, and is then just a link to a note.
 */

/**
 * The parent's blocks with a link to the new sub-note added: in the parent's
 * open page tab, else its first one. Null when the parent has no page tab.
 */
export const withSubNoteLink = (
  parent: NoteDocument,
  subNote: Pick<NoteDocument, "id" | "title">,
): NoteDocument["blocksByTab"] | null => {
  const pages = parent.tabs.filter((tab) => tabKindOf(tab) === "page");
  const tab = pages.find((entry) => entry.id === parent.activeTabId) ?? pages[0];
  if (!tab) return null;
  const blocks = parent.blocksByTab[tab.id] ?? [];
  const link = {
    id: createUuid(),
    type: "paragraph",
    content: [
      {
        type: "link",
        href: buildNoteHref(subNote.id),
        content: [{ type: "text", text: getNoteLinkTitle(subNote.title), styles: {} }],
      },
    ],
  } as NotePartialBlock;
  // A note's last empty line stays last, so there is still somewhere to type.
  const last = blocks.at(-1);
  const keepsLast =
    last?.type === "paragraph" && (!Array.isArray(last.content) || last.content.length === 0);
  const next = keepsLast ? [...blocks.slice(0, -1), link, last] : [...blocks, link];
  return { ...parent.blocksByTab, [tab.id]: next };
};

/** A link's whole text, or null when it isn't plain text. */
const linkText = (content: unknown) =>
  Array.isArray(content) &&
  content.every((item) => isRecord(item) && item.type === "text" && typeof item.text === "string")
    ? content.map((item: { text: string }) => item.text).join("")
    : null;

const renameInBlocks = (
  blocks: readonly unknown[],
  noteId: string,
  from: string,
  to: string,
): { blocks: unknown[]; changed: boolean } => {
  let changed = false;
  const next = blocks.map((block) => {
    if (!isRecord(block)) return block;
    let result = block;
    if (Array.isArray(block.content)) {
      let renamed = false;
      const content = block.content.map((item: unknown) => {
        if (
          !isRecord(item) ||
          item.type !== "link" ||
          typeof item.href !== "string" ||
          readNoteLinkNoteId(item.href) !== noteId ||
          linkText(item.content) !== from
        )
          return item;
        renamed = true;
        const [first] = item.content as Array<{ styles?: unknown }>;
        return { ...item, content: [{ type: "text", text: to, styles: first?.styles ?? {} }] };
      });
      if (renamed) {
        changed = true;
        result = { ...result, content };
      }
    }
    if (Array.isArray(block.children)) {
      const children = renameInBlocks(block.children, noteId, from, to);
      if (children.changed) {
        changed = true;
        result = { ...result, children: children.blocks };
      }
    }
    return result;
  });
  return { blocks: next, changed };
};

/**
 * The parent's blocks with links to a renamed sub-note retitled: those whose
 * text is still the sub-note's old title, so a link the user named stays as
 * they named it. Null when no link changes.
 */
export const withRenamedSubNoteLinks = (
  parent: Pick<NoteDocument, "blocksByTab">,
  subNoteId: string,
  previousTitle: string,
  title: string,
): NoteDocument["blocksByTab"] | null => {
  const from = getNoteLinkTitle(previousTitle);
  const to = getNoteLinkTitle(title);
  if (from === to) return null;
  let changed = false;
  const blocksByTab = Object.fromEntries(
    Object.entries(parent.blocksByTab).map(([tabId, blocks]) => {
      const renamed = renameInBlocks(blocks, subNoteId, from, to);
      changed ||= renamed.changed;
      return [tabId, renamed.changed ? renamed.blocks : blocks];
    }),
  );
  return changed ? (blocksByTab as NoteDocument["blocksByTab"]) : null;
};

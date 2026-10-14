import { buildNoteHref, buildVideoTimestampHref } from "@loam/shared/notes/noteLinks";
import { parseYouTubeUrl } from "@loam/shared/notes/noteVideo";
import type {
  BridgeImportImageRequest,
  BridgeImportNote,
  BridgeImportSkip,
} from "@loam/shared/bridge/loamBridge";
import type { NoteVideo } from "@loam/shared/notes/noteModel";
import { isRecord } from "@loam/shared/utils/isRecord";

import type { ImportConverterInput } from "./importTypes";
import { IMPORT_IMAGE_SCHEME, IMPORT_NOTE_SCHEME, readImportDestination } from "./obsidianSyntax";

/**
 * Post-processing shared by every importer: once notes have ids and images
 * have been copied, rewrite parsed BlockNote blocks so links point at notes,
 * images at the media store, and nothing points anywhere unsafe.
 */

const SAFE_LINK_PATTERN = /^(?:https?:|mailto:)/i;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

const MEDIA_URL_PREFIX = "loam-media://";
const DATA_IMAGE_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,([\s\S]*)$/i;

/** The reference an image block points at, or null for web and data images. */
const readImageReference = (url: string) => {
  const placeholder = readImportDestination(IMPORT_IMAGE_SCHEME, url);
  if (placeholder !== null) return placeholder;
  if (!url || SCHEME_PATTERN.test(url) || url.startsWith("//")) return null;
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
};

const forEachBlock = (blocks: unknown[], visit: (block: Record<string, unknown>) => void) => {
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    visit(block);
    if (Array.isArray(block.children)) forEachBlock(block.children, visit);
  }
};

/** Every local image the blocks refer to, in order. */
export const collectImageReferences = (blocks: unknown[]) => {
  const references: string[] = [];
  forEachBlock(blocks, (block) => {
    if (block.type !== "image" || !isRecord(block.props)) return;
    const url = typeof block.props.url === "string" ? block.props.url : "";
    const reference = readImageReference(url);
    if (reference !== null) references.push(reference);
  });
  return references;
};

/** A note with one page tab, as an importer hands it over. */
export const textNote = (note: {
  id: string;
  title: string;
  folder: string | null;
  tabId: string;
  blocks: unknown[];
  video?: NoteVideo;
}): BridgeImportNote => ({
  id: note.id,
  title: note.title,
  folder: note.folder,
  tabs: [{ id: note.tabId, title: "Notes", kind: "page" }],
  blocksByTab: { [note.tabId]: note.blocks },
  activeTabId: note.tabId,
  ...(note.video ? { video: note.video } : {}),
});

/**
 * Copies every local image the pages refer to, in one request, and returns
 * each page's `resolveImage`. An image that couldn't be copied is reported
 * once, as `label: reference`.
 */
export const copyReferencedImages = async (
  pages: ReadonlyArray<{ path: string; blocks: unknown[] }>,
  saveImages: ImportConverterInput["saveImages"],
  skipped: BridgeImportSkip[],
) => {
  const requests: BridgeImportImageRequest[] = [];
  const indexByKey = new Map<string, number>();
  for (const { path, blocks } of pages)
    for (const reference of collectImageReferences(blocks)) {
      const key = `${path}\n${reference}`;
      if (indexByKey.has(key)) continue;
      indexByKey.set(key, requests.length);
      requests.push({ fromPath: path, reference });
    }
  const results = requests.length ? await saveImages(requests) : [];
  const reported = new Set<string>();
  return (path: string, label = path) =>
    (reference: string): string | null => {
      const result = results[indexByKey.get(`${path}\n${reference}`) ?? -1];
      if (!result) return null;
      if ("url" in result) return result.url;
      const where = `${label}: ${reference}`;
      if (!reported.has(where)) {
        reported.add(where);
        skipped.push({ path: where, reason: result.skipped });
      }
      return null;
    };
};

export type ImportResolveContext = {
  /** The note a wikilink-style placeholder names, as a note id. */
  resolveNote: (target: string) => string | null;
  /** The note a relative link such as `Other.md` points at, as a note id. */
  resolveRelative: (path: string) => string | null;
  /** The media URL an image was copied to, or null when it wasn't. */
  resolveImage: (reference: string) => string | null;
  /** The note's own video, so links to moments in it become timestamps. */
  videoId?: string;
};

const textRun = (text: string) => ({ type: "text", text, styles: {} });

const paragraph = (id: unknown, content: unknown[]) => ({
  id,
  type: "paragraph",
  props: {},
  content,
  children: [],
});

/** A web link to a moment in the note's own video becomes an in-app timestamp link. */
const readOwnVideoSeconds = (href: string, videoId: string | undefined) => {
  if (!videoId) return null;
  const parsed = parseYouTubeUrl(href);
  return parsed?.videoId === videoId && parsed.startSeconds !== undefined
    ? parsed.startSeconds
    : null;
};

const resolveLinkHref = (href: string, context: ImportResolveContext) => {
  const placeholder = readImportDestination(IMPORT_NOTE_SCHEME, href);
  if (placeholder !== null) {
    const noteId = context.resolveNote(placeholder);
    return noteId ? buildNoteHref(noteId) : null;
  }
  if (SAFE_LINK_PATTERN.test(href)) {
    const seconds = readOwnVideoSeconds(href, context.videoId);
    return seconds === null ? href : buildVideoTimestampHref(seconds);
  }
  if (SCHEME_PATTERN.test(href) || href.startsWith("#") || href.startsWith("//")) return null;
  // A relative link to another file in the import.
  const path = href.split(/[?#]/)[0]!;
  let decoded = path;
  try {
    decoded = decodeURI(path);
  } catch {
    // Keep the raw path.
  }
  const noteId = decoded ? context.resolveRelative(decoded) : null;
  return noteId ? buildNoteHref(noteId) : null;
};

const isInlineArray = (value: unknown[]) =>
  value.length > 0 &&
  value.every((item) => isRecord(item) && (item.type === "text" || item.type === "link"));

/** Rewrites links in any inline content, including table cells; others are unwrapped to text. */
const resolveInline = (value: unknown, context: ImportResolveContext): unknown => {
  if (Array.isArray(value)) {
    if (!isInlineArray(value)) return value.map((item) => resolveInline(item, context));
    return value.flatMap((item) => {
      const run = item as Record<string, unknown>;
      if (run.type !== "link") return [run];
      const href = typeof run.href === "string" ? resolveLinkHref(run.href, context) : null;
      const content = Array.isArray(run.content) ? run.content : [];
      return href ? [{ ...run, href }] : content;
    });
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, resolveInline(entry, context)]),
  );
};

/** HTML line breaks between paragraphs parse as a lone newline; make those empty lines. */
const isLoneNewline = (content: unknown) =>
  Array.isArray(content) &&
  content.length === 1 &&
  isRecord(content[0]) &&
  content[0].type === "text" &&
  content[0].text === "\n";

/** Rewrites links and images in parsed blocks; see {@link ImportResolveContext}. */
export const resolveImportedBlocks = (
  blocks: unknown[],
  context: ImportResolveContext,
): unknown[] =>
  blocks.map((block) => {
    if (!isRecord(block)) return block;
    if (block.type === "image" && isRecord(block.props)) {
      const url = typeof block.props.url === "string" ? block.props.url : "";
      // Already copied in, for example from an embedded data URL.
      if (url.startsWith(MEDIA_URL_PREFIX)) return block;
      const reference = readImageReference(url);
      const resolved = reference !== null ? context.resolveImage(reference) : null;
      if (resolved) return { ...block, props: { ...block.props, url: resolved } };
      // Web images are not downloaded, so nothing reaches another host while
      // importing or reading; they stay one click away as links.
      if (reference === null && SAFE_LINK_PATTERN.test(url)) {
        const label =
          (typeof block.props.caption === "string" && block.props.caption) ||
          (typeof block.props.name === "string" && block.props.name) ||
          url;
        return paragraph(block.id, [
          { type: "link", href: url, content: [textRun(`Image: ${label}`)] },
        ]);
      }
      const missing = url.startsWith("data:") ? "embedded image" : (reference ?? url);
      return paragraph(block.id, [textRun(`Image not found: ${missing}`)]);
    }
    return {
      ...block,
      content: isLoneNewline(block.content) ? [] : resolveInline(block.content, context),
      children: Array.isArray(block.children) ? resolveImportedBlocks(block.children, context) : [],
    };
  });

export const decodeBase64 = (text: string) => {
  const binary = atob(text.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

/**
 * Saves images embedded as `data:` URLs (common in HTML exports) and points
 * their blocks at the saved copies. Ones that can't be saved are left for
 * {@link resolveImportedBlocks} to replace with a short note.
 */
export const saveEmbeddedImages = async (
  blocks: unknown[],
  saveImageBytes: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>,
  onSkip: (reason: string) => void,
): Promise<unknown[]> => {
  const saved = new Map<string, string | null>();
  const visit = async (list: unknown[]): Promise<unknown[]> => {
    const next: unknown[] = [];
    for (const block of list) {
      if (!isRecord(block)) {
        next.push(block);
        continue;
      }
      const children = Array.isArray(block.children) ? await visit(block.children) : [];
      const url =
        isRecord(block.props) && typeof block.props.url === "string" ? block.props.url : "";
      const match = block.type === "image" ? DATA_IMAGE_PATTERN.exec(url) : null;
      if (!match) {
        next.push({ ...block, children });
        continue;
      }
      if (!saved.has(url)) {
        try {
          saved.set(url, await saveImageBytes(decodeBase64(match[1]!)));
        } catch (error) {
          saved.set(url, null);
          onSkip(error instanceof Error ? error.message : "Could not save the image");
        }
      }
      const mediaUrl = saved.get(url);
      next.push(
        mediaUrl
          ? { ...block, props: { ...(block.props as object), url: mediaUrl }, children }
          : { ...block, children },
      );
    }
    return next;
  };
  return visit(blocks);
};

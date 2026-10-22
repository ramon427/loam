import type { NoteGraphSnapshot } from "@loam/shared/notes/noteModel";
import { decodeNoteGraphSnapshot } from "@loam/shared/notes/noteGraphSnapshot";
import { isSupportedImageFile } from "../media/imageFileTypes";
import { createNoteGraphSnapshotBlock } from "../graph/noteGraphSnapshotInsertion";
import { insertBlockWithoutText } from "./editorBlockInsertion";
import type { NoteEditorOptions } from "./noteEditorSchema";

/** The parts of a `DataTransfer` the paste policy reads. */
export type Clipboard = {
  types: readonly string[];
  getData: (format: string) => string;
  files: ArrayLike<Pick<File, "name" | "type">>;
  items: ArrayLike<Pick<DataTransferItem, "kind" | "type">>;
};

/** What a paste into a note should do. */
export type PasteAction =
  /** Let BlockNote paste the clipboard as it normally would. */
  | { kind: "default" }
  /** A graph snapshot copied from a graph tab becomes a snapshot block. */
  | { kind: "graphSnapshot"; snapshot: NoteGraphSnapshot }
  /** An image file is saved to the media folder by BlockNote's upload. */
  | { kind: "image" }
  /** External content with its images removed, since only saved images can show. */
  | { kind: "html"; html: string }
  | { kind: "markdown"; markdown: string }
  /** The clipboard held nothing but images from elsewhere. */
  | { kind: "nothing" };

const blockedTags = [
  "base",
  "button",
  "embed",
  "form",
  "iframe",
  "img",
  "input",
  "link",
  "math",
  "meta",
  "object",
  "script",
  "select",
  "style",
  "svg",
  "textarea",
];
const urlAttributes = new Set(["href", "src", "xlink:href"]);

const isSafeAttributeUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || /[\u0000-\u001f\u007f\\]/.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed, "https://app.local");
    if (parsed.origin === "https://app.local") return true;
    return ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol);
  } catch {
    return false;
  }
};

/**
 * Pasted HTML that contains images, minus the images, scripts, form controls and
 * event or style attributes. Null when the HTML has no images, so it can paste as is.
 */
export const stripPastedHtmlImages = (html: string): string | null => {
  const trimmed = html.trim();
  if (!/<img\b/i.test(trimmed)) return null;
  const document = new DOMParser().parseFromString(trimmed, "text/html");
  document.querySelectorAll(blockedTags.join(",")).forEach((element) => element.remove());
  document.body.querySelectorAll("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name === "style" ||
        (urlAttributes.has(name) && !isSafeAttributeUrl(attribute.value))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  return document.body.textContent?.trim() ? document.body.innerHTML.trim() : "";
};

const markdownImagePattern = /!\[[^\]]*]\([^)]*\)|!\[[^\]]*]\[[^\]]*\]/g;

/** Pasted Markdown minus its images; null when it has none, so it can paste as is. */
export const stripPastedMarkdownImages = (markdown: string): string | null => {
  const trimmed = markdown.trim();
  if (!trimmed.match(markdownImagePattern)) return null;
  return trimmed.replace(markdownImagePattern, "").trim();
};

const isSupportedImageType = (type: string) => isSupportedImageFile({ name: "", type });

const hasImageFile = (clipboard: Clipboard) =>
  Array.from(clipboard.files).some(isSupportedImageFile) ||
  Array.from(clipboard.items).some(
    (item) => item.kind === "file" && isSupportedImageType(item.type),
  );

/** Decides how a paste into a note is handled. */
export const decidePaste = (clipboard: Clipboard | null): PasteAction => {
  if (!clipboard) return { kind: "default" };
  // BlockNote's own copy carries its blocks exactly, saved images included; its
  // text/html twin is a lossy export that would go through the image filter below.
  if (clipboard.types.includes("blocknote/html")) return { kind: "default" };

  const plainText = clipboard.getData("text/plain");
  const snapshot = decodeNoteGraphSnapshot(plainText);
  if (snapshot) return { kind: "graphSnapshot", snapshot };
  if (hasImageFile(clipboard)) return { kind: "image" };

  const html = stripPastedHtmlImages(clipboard.getData("text/html"));
  if (html !== null) return html ? { kind: "html", html } : { kind: "nothing" };
  for (const text of [clipboard.getData("text/markdown"), plainText]) {
    const markdown = stripPastedMarkdownImages(text);
    if (markdown !== null) return markdown ? { kind: "markdown", markdown } : { kind: "nothing" };
  }
  return { kind: "default" };
};

type PasteHandler = NonNullable<NoteEditorOptions["pasteHandler"]>;
type PasteEditor = Parameters<PasteHandler>[0]["editor"];

const scrollContainerOf = (editor: PasteEditor) => {
  let element = editor.domElement?.parentElement ?? null;
  while (element && element !== document.body) {
    if (element.scrollHeight > element.clientHeight + 24) return element;
    element = element.parentElement;
  }
  return document.scrollingElement;
};

/**
 * Runs an insertion and puts the page back where it was, right away and over
 * the next two frames, after ProseMirror has scrolled the insertion into view.
 */
const keepingScrollPosition = (editor: PasteEditor, insert: () => void) => {
  const scroller = scrollContainerOf(editor);
  const { scrollLeft = 0, scrollTop = 0 } = scroller ?? {};
  insert();
  if (!scroller) return;
  const restore = () => {
    scroller.scrollLeft = scrollLeft;
    scroller.scrollTop = scrollTop;
  };
  restore();
  requestAnimationFrame(() => {
    restore();
    requestAnimationFrame(restore);
  });
};

/** Moves the cursor to a new line below a paragraph with text, so a pasted image doesn't replace it. */
const makeRoomForPastedImage = (editor: PasteEditor) => {
  const { block } = editor.getTextCursorPosition();
  const hasContent =
    block.type === "paragraph" &&
    Array.isArray(block.content) &&
    block.content.some((item) => item.type !== "text" || item.text.trim());
  if (!hasContent) return;
  editor.insertBlocks([{ type: "paragraph" }], block.id, "after");
  const next = editor.getTextCursorPosition().nextBlock;
  if (next) editor.setTextCursorPosition(next.id, "start");
};

/** BlockNote's `pasteHandler` for notes, applying `decidePaste`. */
export const handleEditorPaste: PasteHandler = ({ event, editor, defaultPasteHandler }) => {
  const action = decidePaste(event.clipboardData);
  switch (action.kind) {
    case "default":
      return defaultPasteHandler();
    case "image":
      makeRoomForPastedImage(editor);
      return defaultPasteHandler();
    case "nothing":
      return true;
    case "graphSnapshot":
      event.preventDefault();
      keepingScrollPosition(editor, () =>
        insertBlockWithoutText(editor, createNoteGraphSnapshotBlock(action.snapshot)),
      );
      return true;
    case "html":
      keepingScrollPosition(editor, () => editor.pasteHTML(action.html));
      return true;
    case "markdown":
      keepingScrollPosition(editor, () => editor.pasteMarkdown(action.markdown));
      return true;
  }
};

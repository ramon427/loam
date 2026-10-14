import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type Ref,
} from "react";
import { runPluginSlashItem } from "../plugins/insertPluginMarkdown";
import { usePluginHost } from "../plugins/PluginSlot";
import { SuggestionMenu } from "@blocknote/core/extensions";
import { useEditorChange } from "@blocknote/react";
import type { EditorState } from "@tiptap/pm/state";
import { LinkIcon, PuzzleIcon } from "lucide-react";

import { BlockNoteEditorView } from "./blocknote/BlockNoteEditorView";
import { ActionMenuItem } from "../action-menu/ActionMenu";
import { InsertImagePopover } from "./blocknote/InsertImagePopover";
import { SlashMenuController } from "./blocknote/SlashMenuController";
import { useNoteEditor } from "./useNoteEditor";
import { useEditorSlashMenu } from "./useEditorSlashMenu";
import type { SlashCommand } from "./slashMenuModel";
import { useEditorTheme } from "./useEditorTheme";
import { useInsertImagePopover } from "./useInsertImagePopover";
import { useImageUpload } from "../media/useImageUpload";
import { rejectNonImageFiles } from "./editorImageOnlyMedia";
import type { NoteBlock } from "./noteEditorSchema";
import { beginPendingUpload } from "../media/pendingUploads";
import { NoteRouteGlyph } from "../ui/NoteRouteIcon";
import { buildNoteHref, buildVideoTimestampHref } from "@loam/shared/notes/noteLinks";
import {
  formatVideoTimestamp,
  parseYouTubeUrl,
  type ParsedYouTubeUrl,
} from "@loam/shared/notes/noteVideo";

import { NoteGraphSnapshotContext } from "../graph/NoteGraphSnapshotBlock";
import type { NoteDocument, NotePlace } from "../workspace/types";
import type { NoteTab } from "@loam/shared/notes/noteModel";
import type { TabHistoryCommands } from "../note/useTypedTabHistory";
import type { NoteContentPatch } from "../workspace/NotesWorkspace";
import { resolveAppLink } from "./editorLinks";
import { createNoteHeadingDecorations } from "./noteHeadingDecoration";
import {
  listNoteHeadingConnectionOptions,
  listNoteHeadingConnectionTargets,
  toggleNoteHeadingConnection,
  type NoteHeadingConnectionTarget,
} from "./noteHeadingConnections";
import { NoteLinkNavigationContext } from "./noteLinkNavigation";
import {
  buildNoteMentionMenuItems,
  type NoteLinkCandidate,
  type NoteMentionMenuItem,
} from "./noteMentions";
import { ConnectedHeadingDeleteDialog } from "./ConnectedHeadingDeleteDialog";
import { HeadingTargetManager } from "./HeadingTargetManager";
import { NoteLinkMenuItems } from "./NoteLinkMenuItems";
import { NoteMentionMenuController } from "./NoteMentionMenu";
import { useHeadingDeletionGuard } from "./useHeadingDeletionGuard";
import { useBlockReveal, type BlockRevealRequest } from "./useBlockReveal";
import { useNoteLinkDecorations } from "./useNoteLinkDecorations";
import { useTabUndoHistory } from "./useTabUndoHistory";

/** What the note's toolbar and video pane ask of the page tab in view. */
export type PageTabCommands = TabHistoryCommands & {
  insertVideoTimestamp(seconds: number): void;
};

const isPlainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * One page tab's editor. The note owns the tab's blocks; this editor starts
 * from them and reports every change. The note view gives each tab its own
 * editor, so switching tabs never swaps the document under one.
 */
export function PageTabEditor({
  note,
  tab,
  readOnly,
  onChange,
  onOpenNote,
  onOpenPlace,
  listLinkableNotes,
  reveal,
  commands,
  currentVideoTimestamp = null,
  onPasteVideoLink,
}: {
  note: NoteDocument;
  tab: NoteTab;
  readOnly: boolean;
  /** Changes the note; the function gets the note as it is now. */
  onChange: (change: (note: NoteDocument) => NoteContentPatch) => void;
  onOpenNote: (noteId: string, options?: { tabId?: string }) => void;
  onOpenPlace: (place: NotePlace) => void;
  /** The notes `@` and "Link to note" offer, read when the menu opens. */
  listLinkableNotes: () => readonly NoteLinkCandidate[];
  reveal: BlockRevealRequest | null;
  commands: Ref<PageTabCommands | null>;
  /** The timestamp whose part of the video is playing, marked in the text. */
  currentVideoTimestamp?: number | null;
  /** Called after a YouTube link is pasted, so the note can offer to attach it. */
  onPasteVideoLink?: (video: ParsedYouTubeUrl) => void;
}) {
  const theme = useEditorTheme();
  const { uploadImage } = useImageUpload();
  const headingOptions = useMemo(() => listNoteHeadingConnectionOptions(note), [note]);
  const createDecorations = useCallback(
    (state: EditorState) => createNoteHeadingDecorations(state, headingOptions, tab.id),
    [headingOptions, tab.id],
  );
  const uploadFile = useCallback(
    async (file: File) => {
      const finished = beginPendingUpload();
      try {
        const saved = await uploadImage(file);
        if (!saved) throw new Error("The image could not be saved.");
        return saved.path;
      } finally {
        finished();
      }
    },
    [uploadImage],
  );
  const editor = useNoteEditor({
    createDecorations,
    initialContent: note.blocksByTab[tab.id] ?? [],
    uploadFile,
  });
  const guard = useHeadingDeletionGuard(editor, note, readOnly);
  useTabUndoHistory(editor, `${note.id}:${tab.id}`, guard.tombstones);

  useEditorChange(() => {
    if (readOnly) return;
    const blocks = editor.document;
    onChange((latest) => {
      const blocksByTab = { ...latest.blocksByTab, [tab.id]: blocks };
      return { blocksByTab, ...guard.takeLinkChange({ ...latest, blocksByTab }) };
    });
  }, editor);

  const linkableNotes = useRef(listLinkableNotes);
  useLayoutEffect(() => {
    linkableNotes.current = listLinkableNotes;
  });
  const readLinkableNotes = useCallback(() => linkableNotes.current(), []);

  /** Inserts a link at the cursor, with a space before it if it would touch a word. */
  const insertLink = useCallback(
    (label: string, href: string) => {
      if (readOnly) return;
      editor.focus();
      const { selection, doc } = editor.prosemirrorState;
      const before =
        selection.from > 0 ? doc.textBetween(selection.from - 1, selection.from, "", "￼") : "";
      const spaced = before.length > 0 && !/\s/u.test(before);
      editor.insertInlineContent(
        [...(spaced ? [" "] : []), { type: "link", href, content: label }, " "],
        { updateSelection: true },
      );
    },
    [editor, readOnly],
  );
  const insertVideoTimestamp = useCallback(
    (seconds: number, label?: string) =>
      insertLink(label || formatVideoTimestamp(seconds), buildVideoTimestampHref(seconds)),
    [insertLink],
  );

  useImperativeHandle(
    commands,
    () => ({
      undo: () => {
        editor.undo();
      },
      redo: () => {
        editor.redo();
      },
      insertVideoTimestamp: (seconds) => insertVideoTimestamp(seconds),
    }),
    [editor, insertVideoTimestamp],
  );

  useNoteLinkDecorations(editor, {
    hasVideo: Boolean(note.video),
    currentVideoTimestamp,
    readLinkCandidates: readLinkableNotes,
  });

  const noteLinkCommand = useMemo<SlashCommand>(
    () => ({
      key: "note_link",
      title: "Link to note",
      subtext: "Search your notes and insert a link.",
      aliases: ["note", "link", "mention", "page"],
      group: "Notes",
      icon: <NoteRouteGlyph className="size-4" />,
      // The slash command and its query are already removed; continue in the note picker.
      onItemClick: () =>
        editor.getExtension(SuggestionMenu)?.openSuggestionMenu("@", {
          deleteTriggerCharacter: true,
          ignoreQueryLength: true,
        }),
    }),
    [editor],
  );
  const { slashItems: pluginSlashItems } = usePluginHost();
  const extraCommands = useMemo<SlashCommand[]>(
    () => [
      noteLinkCommand,
      ...pluginSlashItems.map((item): SlashCommand => ({
        key: `plugin:${item.pluginId}.${item.id}`,
        title: item.title,
        subtext: item.subtext,
        aliases: item.aliases,
        group: "Plugins",
        icon: <PuzzleIcon className="size-4" aria-hidden />,
        onItemClick: () => void runPluginSlashItem(editor, item, note.id),
      })),
    ],
    [editor, note.id, noteLinkCommand, pluginSlashItems],
  );
  const imagePopover = useInsertImagePopover(editor);
  const { closeImagePopover } = imagePopover;
  const slashMenu = useEditorSlashMenu({
    editor,
    extraItems: extraCommands,
    onInsertImage: imagePopover.insertImageBlock,
  });
  useEffect(() => {
    if (readOnly) closeImagePopover();
  }, [closeImagePopover, readOnly]);

  const getMentionItems = useCallback(
    async (query: string) => buildNoteMentionMenuItems(note, query, readLinkableNotes()),
    [note, readLinkableNotes],
  );
  const insertMention = useCallback(
    (item: NoteMentionMenuItem) => {
      if (item.noteId !== undefined) insertLink(item.title, buildNoteHref(item.noteId));
      else insertVideoTimestamp(item.seconds, item.title);
    },
    [insertLink, insertVideoTimestamp],
  );

  // A heading's context menu manages the graph nodes and table rows that link to it.
  const [managedHeadingId, setManagedHeadingId] = useState<string | null>(null);
  const managedHeading = headingOptions.find(
    (heading) => heading.headingBlockId === managedHeadingId,
  );
  const targets = useMemo(() => listNoteHeadingConnectionTargets(note), [note]);
  const headingMenuItems = (block: NoteBlock) => {
    const heading =
      block.type === "heading"
        ? headingOptions.find((option) => option.headingBlockId === block.id)
        : undefined;
    if (!heading) return null;
    return (
      <ActionMenuItem
        icon={<LinkIcon aria-hidden="true" />}
        onSelect={() => setManagedHeadingId(block.id)}
      >
        {heading.connectionCount > 0
          ? `Connections (${heading.connectionCount})`
          : "Manage connections"}
      </ActionMenuItem>
    );
  };
  const toggleTarget = (target: NoteHeadingConnectionTarget) => {
    if (!managedHeadingId || readOnly) return;
    onChange((latest) => toggleNoteHeadingConnection(latest, target, managedHeadingId));
  };

  const deletionImpact = guard.pending
    ? {
        action: guard.pending.action,
        headings: headingOptions.filter((heading) =>
          guard.pending!.headingBlockIds.includes(heading.headingBlockId),
        ),
        targets: targets.filter((target) =>
          target.headingBlockIds.some((id) => guard.pending!.headingBlockIds.includes(id)),
        ),
      }
    : null;

  useBlockReveal(editor, reveal);

  const followLink = (event: MouseEvent<HTMLElement>) => {
    const anchor =
      event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!anchor || !event.currentTarget.contains(anchor)) return;
    const target = resolveAppLink(anchor.getAttribute("href") ?? "", note);
    // Links to the web open outside the app, as BlockNote handles them.
    if (!target) return;
    // A middle click on an in-app link would try to open a new window, so it does nothing.
    const isMiddleClick = event.type === "auxclick";
    if (isMiddleClick && event.button !== 1) return;
    // While editing, a plain click on a note link places the cursor; its toolbar offers "Open note".
    if (!isMiddleClick && target.kind === "note" && !readOnly && isPlainClick(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    if (isMiddleClick) return;
    if (target.kind === "note") onOpenNote(target.noteId);
    else if (target.kind === "video") onOpenPlace(target);
  };

  return (
    <NoteLinkNavigationContext value={onOpenNote}>
      <NoteGraphSnapshotContext
        value={{
          note,
          // A snapshot opens the graph it shows, in this note or another.
          onOpenSource: (snapshot) =>
            snapshot.noteId === note.id
              ? onOpenPlace({ kind: "graph", tabId: snapshot.tabId })
              : onOpenNote(snapshot.noteId, { tabId: snapshot.tabId }),
        }}
      >
        <div
          className="contents"
          onClickCapture={followLink}
          onAuxClickCapture={followLink}
          onDropCapture={(event) => {
            if (!readOnly && rejectNonImageFiles(event.nativeEvent)) event.stopPropagation();
          }}
          onPasteCapture={(event) => {
            if (readOnly) return;
            if (rejectNonImageFiles(event.nativeEvent)) {
              event.stopPropagation();
              return;
            }
            const video = parseYouTubeUrl(event.clipboardData.getData("text/plain"));
            if (video) onPasteVideoLink?.(video);
          }}
        >
          <BlockNoteEditorView
            editor={editor}
            theme={theme}
            editable={!readOnly && !guard.pending}
            featureBlockMenuItems={headingMenuItems}
            linkMenuItems={({ href, text }) => (
              <NoteLinkMenuItems
                href={href}
                text={text}
                target={resolveAppLink(href, note)}
                onOpenNote={onOpenNote}
                onOpenPlace={onOpenPlace}
              />
            )}
            beforeEditor={
              <>
                <SlashMenuController
                  enabled={!readOnly}
                  getItems={slashMenu.getSlashItems}
                  onItemClick={slashMenu.handleSlashItemClick}
                />
                <NoteMentionMenuController
                  enabled={!readOnly}
                  getItems={getMentionItems}
                  onItemClick={insertMention}
                />
              </>
            }
          />
        </div>
      </NoteGraphSnapshotContext>

      {readOnly ? null : (
        <InsertImagePopover
          open={imagePopover.imagePopoverState.open}
          anchorRect={imagePopover.imagePopoverState.anchorRect}
          onOpenChange={(open) => {
            if (!open) closeImagePopover();
          }}
          onInvalidImageInput={imagePopover.discardPendingImageBlock}
          onInsertImage={imagePopover.insertImage}
          onUploadFile={uploadFile}
        />
      )}
      {managedHeading ? (
        <HeadingTargetManager
          onClose={() => setManagedHeadingId(null)}
          headingBlockId={managedHeading.headingBlockId}
          headingLabel={managedHeading.title}
          targets={targets}
          readOnly={readOnly}
          onToggleTarget={toggleTarget}
          onOpenTarget={(target) => {
            setManagedHeadingId(null);
            onOpenPlace({ kind: target.kind, tabId: target.tabId, targetId: target.targetId });
          }}
        />
      ) : null}
      <ConnectedHeadingDeleteDialog
        impact={deletionImpact}
        onCancel={guard.cancel}
        onConfirm={guard.confirm}
      />
    </NoteLinkNavigationContext>
  );
}

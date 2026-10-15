import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { cn } from "../ui/cn";
import { editorStyles as styles } from "../editor/blocknote/blockNoteStyles";
import { EditorShell } from "../editor/blocknote/EditorShell";
import { toastError } from "../ui/toast";
import { useEditorTheme } from "../editor/useEditorTheme";
import {
  isFileTabKind,
  tabKindOf,
  tabTitleOf,
  type FileTabKind,
  type NoteGraphSnapshot,
} from "@loam/shared/notes/noteModel";

import { EmbedTab } from "../embed/EmbedTab";
import { FileTab } from "../files/FileTab";
import { useBesideTab } from "../files/useBesideTab";
import { NoteBacklinksMenu } from "./NoteBacklinksMenu";
import { listNoteHeadingConnectionOptions } from "../editor/noteHeadingConnections";
import headingConnectionStyles from "../editor/headingConnections.module.css";
import { NoteDocumentFrame } from "./NoteDocumentFrame";
import { NoteEditorSwitchLoading } from "./NoteEditorSwitchLoading";
import type { PageTabCommands } from "../editor/PageTabEditor";
import type { BlockRevealRequest } from "../editor/useBlockReveal";
import type { TabHistoryCommands } from "./useTypedTabHistory";
import { createNoteGraph } from "../graph/noteGraph";
import { insertNoteGraphSnapshot } from "../graph/noteGraphSnapshotInsertion";
import type { NoteTableSelection } from "../table/NoteTablePanel";
import { createNoteBoard } from "../board/noteBoard";
import { createNoteTable } from "../table/noteTable";
import type { NoteDocument, NotePlace } from "../workspace/types";
import { NoteVideoPlayer } from "../video/NoteVideoPlayer";
import { MIN_VIDEO_PANE_WIDTH } from "../video/useVideoPane";
import { VideoLinkForm } from "../video/VideoLinkForm";
import { VideoPane } from "../video/VideoPane";
import { useNotesWorkspace, type NoteContentPatch } from "../workspace/NotesWorkspace";
import { PluginSlot } from "../plugins/PluginSlot";
import { NoteBreadcrumbs } from "./NoteBreadcrumbs";
import { NoteHeader } from "./NoteHeader";
import { NoteLayout } from "./NoteLayout";
import { NoteTitleField } from "./NoteTitleField";
import { NoteToolbar } from "./NoteToolbar";
import { notePathOf } from "./notePath";
import { activeTabOf } from "./noteTabs";
import { NoteViewTabs } from "./NoteViewTabs";
import { StoredTable } from "./StoredTable";
import { TAB_KINDS } from "./tabKinds";
import { useNoteTabEdits } from "./useNoteTabEdits";
import { useNoteVideo } from "./useNoteVideo";

// The editors load with the first note that shows them.
const PageTabEditor = lazy(() =>
  import("../editor/PageTabEditor").then((module) => ({ default: module.PageTabEditor })),
);
const NoteGraphPanel = lazy(() =>
  import("../graph/NoteGraphPanel").then((module) => ({ default: module.NoteGraphPanel })),
);
const NoteBoardPanel = lazy(() =>
  import("../board/NoteBoardPanel").then((module) => ({ default: module.NoteBoardPanel })),
);
const NoteTablePanel = lazy(() =>
  import("../table/NoteTablePanel").then((module) => ({ default: module.NoteTablePanel })),
);

type GraphSelection = { nodeId: string | null; edgeId: string | null };

/**
 * The open note: its header with title and tabs, the tab in view, and its
 * video beside it. Every change goes through the workspace's `updateNote`,
 * whose copy of the note is the only one.
 */
export function NoteView({
  note,
}: {
  /** The open note, read in full. */
  note: NoteDocument;
}) {
  const { updateNote, openNote, openRequest, notes, folders, projects } = useNotesWorkspace();
  const theme = useEditorTheme();
  const update = useCallback(
    (change: NoteContentPatch | ((latest: NoteDocument) => NoteContentPatch)) =>
      updateNote(note.id, change),
    [note.id, updateNote],
  );
  const activeTab = activeTabOf(note);
  const activeKind = tabKindOf(activeTab);
  const isGraph = activeKind === "graph";
  // A graph and a board fill the window, not a sheet of paper.
  const isFull = isGraph || activeKind === "board";

  // What the tab in view selects, and what it was asked to show.
  const [graphSelection, setGraphSelection] = useState<GraphSelection>({
    nodeId: null,
    edgeId: null,
  });
  const [graphReveal, setGraphReveal] = useState<{ nodeId: string; requestId: number } | null>(
    null,
  );
  const [tableSelection, setTableSelection] = useState<NoteTableSelection | null>(null);
  const [blockReveal, setBlockReveal] = useState<BlockRevealRequest | null>(null);
  /** Goes up when a page tab's blocks change outside its editor, which then starts over. */
  const [bodyRevision, setBodyRevision] = useState(0);
  const pageCommands = useRef<PageTabCommands | null>(null);
  const graphHistory = useRef<TabHistoryCommands | null>(null);
  const tableHistory = useRef<TabHistoryCommands | null>(null);

  const video = useNoteVideo({ note, update, pageCommands, pageInView: activeKind === "page" });
  const { pane, hasVideo } = video;
  const [besideTabId, setBesideTabId] = useBesideTab(note.id);
  // A file tab shows beside the note while the video doesn't, and never beside itself.
  const besideTab = pane.isOpen
    ? undefined
    : note.tabs.find(
        (tab) => tab.id === besideTabId && tab.id !== activeTab.id && isFileTabKind(tabKindOf(tab)),
      );
  const besideOpen = pane.isOpen || besideTab !== undefined;
  const path = useMemo(
    () => notePathOf(note, { notes, folders, projects }),
    [note, notes, folders, projects],
  );
  const headingOptions = useMemo(() => listNoteHeadingConnectionOptions(note), [note]);
  const listLinkableNotes = useCallback(() => {
    const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]));
    return notes.map((entry) => ({
      id: entry.id,
      title: entry.title,
      folderName: entry.folderId ? (folderNames.get(entry.folderId) ?? null) : null,
    }));
  }, [folders, notes]);

  const selectTab = useCallback(
    (tabId: string) => {
      setGraphSelection({ nodeId: null, edgeId: null });
      setGraphReveal(null);
      setTableSelection(null);
      update((latest) => (latest.activeTabId === tabId ? {} : { activeTabId: tabId }));
    },
    [update],
  );

  /** Shows a place in this note: a moment in its video, a graph, a graph node, a table row or column. */
  const openPlace = useCallback(
    (place: NotePlace) => {
      if (place.kind === "video") {
        pane.seekTo(place.seconds);
        return;
      }
      if (!note.tabs.some((tab) => tab.id === place.tabId)) return;
      selectTab(place.tabId);
      if (place.kind === "graph-node") {
        setGraphSelection({ nodeId: place.targetId, edgeId: null });
        setGraphReveal((current) => ({
          nodeId: place.targetId,
          requestId: (current?.requestId ?? 0) + 1,
        }));
      } else if (place.kind !== "graph") {
        setTableSelection({
          tabId: place.tabId,
          kind: place.kind === "table-row" ? "row" : "column",
          id: place.targetId,
        });
      }
    },
    [note.tabs, pane, selectTab],
  );

  /** Shows a heading in its page tab, as following a link from a graph node or table row does. */
  const openHeading = useCallback(
    (headingBlockId: string) => {
      const heading = headingOptions.find((option) => option.headingBlockId === headingBlockId);
      if (!heading) return;
      selectTab(heading.tabId);
      setBlockReveal((current) => ({
        id: (current?.id ?? 0) + 1,
        blockId: headingBlockId,
        highlight: true,
      }));
    },
    [headingOptions, selectTab],
  );

  // A request to open this note at a tab applies once.
  const handledRequest = useRef<number | null>(null);
  useEffect(() => {
    if (!openRequest || openRequest.noteId !== note.id || handledRequest.current === openRequest.id)
      return;
    handledRequest.current = openRequest.id;
    if (openRequest.tabId && note.tabs.some((tab) => tab.id === openRequest.tabId))
      selectTab(openRequest.tabId);
  }, [note.id, note.tabs, openRequest, selectTab]);
  // A new note opens with its title ready to type.
  const [titleFocusRequest] = useState(() =>
    openRequest?.noteId === note.id && openRequest.focusTitle ? openRequest.id : null,
  );

  const edits = useNoteTabEdits({
    note,
    update,
    selectGraphNode: (nodeId) => setGraphSelection({ nodeId, edgeId: null }),
    selectTableTarget: setTableSelection,
  });

  /** Puts a graph snapshot at the end of a page tab, then shows it there. */
  const insertSnapshot = (snapshot: NoteGraphSnapshot, pageTabId?: string) => {
    let inserted: NoteDocument | null = null;
    update((latest) => {
      inserted = insertNoteGraphSnapshot(latest, snapshot, pageTabId);
      return inserted
        ? {
            tabs: inserted.tabs,
            activeTabId: inserted.activeTabId,
            blocksByTab: inserted.blocksByTab,
          }
        : {};
    });
    const next = inserted as NoteDocument | null;
    if (!next) {
      toastError("Could not insert snapshot", {
        description: "Choose an existing page tab or copy the snapshot to another note.",
      });
      return false;
    }
    const blocks = next.blocksByTab[next.activeTabId]!;
    setBodyRevision((revision) => revision + 1);
    setBlockReveal((current) => ({
      id: (current?.id ?? 0) + 1,
      blockId: blocks.at(-2)!.id!,
      cursorBlockId: blocks.at(-1)!.id!,
    }));
    return true;
  };

  /** Shows a file tab beside the note, in the video's place, or stops showing one there. */
  const showBeside = (tabId: string | null) => {
    setBesideTabId(tabId);
    if (!tabId) return;
    video.closeVideo();
    // The tab leaves the note's own column for the one beside it.
    const other = note.tabs.find((tab) => tab.id !== tabId);
    if (tabId === activeTab.id && other) selectTab(other.id);
  };

  // Choosing the tab shown beside the note brings it back into the note.
  const chooseTab = (tabId: string) => {
    if (tabId === besideTab?.id) setBesideTabId(null);
    selectTab(tabId);
  };

  const historyOfActiveTab = () => {
    if (activeKind === "graph") return graphHistory.current;
    if (activeKind === "table" || activeKind === "board") return tableHistory.current;
    return pageCommands.current;
  };

  let body: ReactNode;
  if (activeKind === "page") {
    body = (
      <PageTabEditor
        key={`${activeTab.id}:${bodyRevision}`}
        note={note}
        tab={activeTab}
        readOnly={false}
        onChange={update}
        onOpenNote={openNote}
        onOpenPlace={openPlace}
        listLinkableNotes={listLinkableNotes}
        reveal={blockReveal}
        commands={pageCommands}
        currentVideoTimestamp={video.playingTimestamp}
        onPasteVideoLink={hasVideo ? undefined : video.offerPastedVideo}
      />
    );
  } else if (activeKind === "board") {
    body = (
      <StoredTable
        key={activeTab.id}
        note={note}
        tabId={activeTab.id}
        create={createNoteBoard}
        onCreate={(table) => edits.updateTable(activeTab.id, table)}
      >
        {(table) => (
          <NoteBoardPanel
            tabId={activeTab.id}
            table={table}
            onUpdateTable={(next) => edits.updateTable(activeTab.id, next)}
            historyBridgeRef={tableHistory}
          />
        )}
      </StoredTable>
    );
  } else if (isFileTabKind(activeKind)) {
    body = (
      <FileTab
        key={activeTab.id}
        kind={activeKind}
        file={note.filesByTab?.[activeTab.id]}
        onChangeFile={(file) =>
          update((latest) => ({ filesByTab: { ...latest.filesByTab, [activeTab.id]: file } }))
        }
      />
    );
  } else if (activeKind === "embed") {
    body = (
      <EmbedTab
        key={activeTab.id}
        address={note.embedsByTab?.[activeTab.id]?.url ?? ""}
        onChange={(url) =>
          update((latest) => ({ embedsByTab: { ...latest.embedsByTab, [activeTab.id]: { url } } }))
        }
      />
    );
  } else {
    const graph = note.graphsByTab?.[activeTab.id];
    // A selection the tab no longer has (another graph, a deleted row) shows as none.
    const selectedNodeId = graph?.nodes.some((node) => node.id === graphSelection.nodeId)
      ? graphSelection.nodeId
      : null;
    const selectedEdgeId = graph?.edges.some((edge) => edge.id === graphSelection.edgeId)
      ? graphSelection.edgeId
      : null;
    body = (
      <div key={activeTab.id} className={cn("w-full", isFull ? "h-full min-h-0" : "min-h-[34rem]")}>
        {isGraph ? (
          <NoteGraphPanel
            tabId={activeTab.id}
            note={note}
            graph={graph}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            revealNodeRequest={graphReveal}
            readOnly={false}
            onAddGraph={() => edits.updateGraph(activeTab.id, createNoteGraph(note))}
            onUpdateGraph={(next) => edits.updateGraph(activeTab.id, next)}
            onSelectNode={(nodeId) => setGraphSelection((current) => ({ ...current, nodeId }))}
            onSelectEdge={(edgeId) => setGraphSelection((current) => ({ ...current, edgeId }))}
            headingOptions={headingOptions}
            onToggleHeadingConnection={edits.toggleNodeHeading}
            onOpenHeading={openHeading}
            historyBridgeRef={graphHistory}
            onSeekVideoTimestamp={hasVideo ? pane.seekTo : undefined}
            getVideoSeconds={hasVideo ? pane.position : undefined}
            onInsertSnapshot={insertSnapshot}
          />
        ) : (
          <StoredTable
            note={note}
            tabId={activeTab.id}
            create={createNoteTable}
            onCreate={(table) => edits.updateTable(activeTab.id, table)}
          >
            {(table) => (
              <NoteTablePanel
                tab={activeTab}
                table={table}
                selectedTarget={tableSelection?.tabId === activeTab.id ? tableSelection : null}
                readOnly={false}
                onSelectTarget={setTableSelection}
                onUpdateTable={(next) => edits.updateTable(activeTab.id, next)}
                headingOptions={headingOptions}
                onToggleHeadingConnection={edits.toggleTableHeading}
                onOpenHeading={openHeading}
                historyBridgeRef={tableHistory}
              />
            )}
          </StoredTable>
        )}
      </div>
    );
  }

  const header = (
    <NoteHeader
      title={
        <>
          <NoteBreadcrumbs path={path} onOpenNote={openNote} />
          <NoteTitleField
            value={note.title}
            onChange={(title) => update({ title })}
            focusRequest={titleFocusRequest}
          />
        </>
      }
      actions={
        <>
          <PluginSlot name="note.header" props={{ noteId: note.id, title: note.title }} />
          <NoteBacklinksMenu key={note.id} noteId={note.id} onOpenNote={openNote} />
          <NoteToolbar
            onUndo={() => historyOfActiveTab()?.undo()}
            onRedo={() => historyOfActiveTab()?.redo()}
          />
        </>
      }
    />
  );

  const tabs = (
    <NoteViewTabs
      note={note}
      activeTabId={activeTab.id}
      besideTabId={besideTab?.id ?? null}
      onSelect={chooseTab}
      onShowBeside={showBeside}
      edits={edits}
      video={video}
    />
  );

  let videoContent: ReactNode;
  if (note.video && video.linkForm !== "change")
    videoContent = (
      <NoteVideoPlayer
        video={note.video}
        timestamps={video.timestamps}
        startSeconds={pane.startSeconds}
        seekRequest={pane.seekRequest}
        canInsertTimestamp={video.canInsertTimestamp}
        commands={video.playerCommands}
        onPosition={pane.trackPosition}
        onSeek={pane.seekTo}
        onInsertTimestamp={(seconds) => pageCommands.current?.insertVideoTimestamp(seconds)}
      />
    );
  else
    videoContent = (
      <VideoLinkForm
        key={video.linkForm ?? "add"}
        currentUrl={video.linkForm === "change" ? (note.video?.url ?? "") : ""}
        autoFocus={video.linkForm !== null}
        onChoose={video.chooseVideo}
        onCancel={video.linkForm === "change" ? video.cancelChange : undefined}
      />
    );

  let documentMode: "full" | "immersive" | "paper" = "paper";
  if (isFull) documentMode = "full";
  else if (besideOpen) documentMode = "immersive";
  let paperClassName: string | undefined;
  if (isFull) paperClassName = "h-full min-h-0 max-w-none p-0";
  else if (activeKind === "table" || activeKind === "embed" || isFileTabKind(activeKind))
    paperClassName = "min-h-[34rem] max-w-none p-0";

  return (
    <NoteLayout header={header}>
      <div
        className="@container/note-view min-h-full w-full"
        style={
          besideOpen
            ? ({
                "--video-pane-min": `${MIN_VIDEO_PANE_WIDTH}px`,
                "--video-pane-width": `${pane.width}px`,
              } as CSSProperties)
            : undefined
        }
      >
        <div className="flex min-h-full w-full flex-col">
          <NoteDocumentFrame
            mode={documentMode}
            tabs={tabs}
            paperClassName={paperClassName}
            resizable
            side={
              pane.isOpen ? (
                <VideoPane
                  width={pane.width}
                  maximized={pane.isMaximized}
                  onStartResize={pane.startResize}
                >
                  {videoContent}
                </VideoPane>
              ) : besideTab ? (
                <VideoPane
                  label={`${tabTitleOf(besideTab)}, beside the note`}
                  width={pane.width}
                  maximized={false}
                  onStartResize={pane.startResize}
                >
                  <FileTab
                    key={besideTab.id}
                    kind={tabKindOf(besideTab) as FileTabKind}
                    file={note.filesByTab?.[besideTab.id]}
                    onChangeFile={(file) =>
                      update((latest) => ({
                        filesByTab: { ...latest.filesByTab, [besideTab.id]: file },
                      }))
                    }
                  />
                </VideoPane>
              ) : undefined
            }
            sideFills={pane.isMaximized}
          >
            <EditorShell
              isActive
              contentKey={`${note.id}:${activeTab.id}`}
              rootClassName={cn(
                styles.notesEditorRoot,
                styles.noteMentionsRoot,
                headingConnectionStyles.root,
                theme === "dark" && styles.dark,
              )}
              containerClassName={isFull ? "h-full min-h-0 flex-1" : undefined}
            >
              <Suspense
                fallback={<NoteEditorSwitchLoading label={TAB_KINDS[activeKind].loadingLabel} />}
              >
                {body}
              </Suspense>
            </EditorShell>
          </NoteDocumentFrame>
        </div>
      </div>
    </NoteLayout>
  );
}

import { useKeyPress } from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";

import { cn } from "../ui/cn";
import { HeadingConnectionManager } from "../editor/HeadingConnectionManager";
import { useShiftKeyHeld } from "./useShiftKeyHeld";
import { imageInputAccept } from "../media/imageFileTypes";

import {
  NoteGraphBottomStack,
  NoteGraphChip,
  NoteGraphOutline,
  NoteGraphStatus,
  NoteGraphWalkthroughBar,
  NoteGraphWarnings,
  NoteGraphZoomControls,
} from "./NoteGraphCanvasOverlays";
import { NoteGraphFlow } from "./NoteGraphFlow";
import { resolveNoteGraphViewPreferences } from "./noteGraph";
import { noteGraphDecorations, toFlowEdge, toFlowNodes } from "./noteGraphFlowElements";
import { NoteGraphAlignmentGuides, NoteGraphEdgeLabelEditor } from "./NoteGraphFlowOverlays";
import { NoteGraphImportDialog } from "./NoteGraphImportDialog";
import { NoteGraphInspector } from "./NoteGraphInspector";
import { findCollapsedFrameHiddenNodeIds } from "./noteGraphFrames";
import { countNoteGraphCycleEdges } from "./noteGraphLayout";
import { NoteGraphNodeActionsContext } from "./noteGraphNodeActions";
import * as ops from "./noteGraphOps";
import type { NoteGraphPanelProps } from "./NoteGraphPanel";
import { noteGraphShapeDragType, resolveNoteGraphPaneDrop } from "./noteGraphPaneDrop";
import { NoteGraphSearchPanel } from "./NoteGraphSearchPanel";
import { edgeLabelEditorPoint, selectionToolbarAnchor } from "./noteGraphOverlayAnchors";
import { NoteGraphEdgeToolbar, NoteGraphNodeToolbar } from "./NoteGraphSelectionToolbar";
import { NoteGraphSnapshotCapture } from "./NoteGraphSnapshotCapture";
import { NoteGraphToolbar } from "./NoteGraphToolbar";
import { useNoteGraphActionMenu } from "./useNoteGraphActionMenu";
import { NoteGraphMenu } from "./NoteGraphMenu";
import { ActionMenuContent } from "../action-menu/ActionMenu";
import { ContextMenu, ContextMenuTrigger } from "../ui/ContextMenu";
import { useNoteGraphDocument } from "./useNoteGraphDocument";
import { useNoteGraphEdits } from "./useNoteGraphEdits";
import { useNoteGraphFlowBinding } from "./useNoteGraphFlowBinding";
import { useNoteGraphImages } from "./useNoteGraphImages";
import { createNoteGraphKeyCommands } from "./noteGraphKeyCommands";
import { handleNoteGraphKeyDown } from "./noteGraphKeymap";
import { useNoteGraphMode } from "./useNoteGraphMode";
import { useNoteGraphNodeActions } from "./useNoteGraphNodeActions";
import { useNoteGraphNodeCommands } from "./useNoteGraphNodeCommands";
import { useNoteGraphPaneGestures } from "./useNoteGraphPaneGestures";
import { useNoteGraphSearch } from "./useNoteGraphSearch";
import { useNoteGraphSelection } from "./useNoteGraphSelection";
import { useNoteGraphTransfer } from "./useNoteGraphTransfer";
import { useNoteGraphViewport } from "./useNoteGraphViewport";
import { tabKindOf, type NoteGraph } from "@loam/shared/notes/noteModel";

const keyboardHints =
  "Graph canvas keyboard shortcuts. Drag on empty canvas to pan. Hold Control or Command and drag on empty canvas to rectangle-select nodes. Hold Shift, Control, or Command and click to add to the selection. Arrow keys move the selected node. Control or Command plus arrow keys resizes the selected node. Hold Shift while dragging a resize handle to keep the aspect ratio. Double-click a resize handle to fit the node to its content. Control plus Enter creates a node. C starts keyboard connecting: arrow keys choose a target and Enter connects. Control plus F searches nodes. Control plus 0 fits the view, Control plus 1 sets 100 percent zoom, Control plus 2 zooms to the selection. Control plus equals or minus zooms. F toggles focus mode. Tab while editing a title creates a connected child node; Shift plus Tab creates a connected sibling.";

/**
 * The editable graph canvas. It wires the graph document, selection, mode and viewport to
 * React Flow and to the toolbar, panels and overlays around it.
 */
export function NoteGraphCanvas(props: NoteGraphPanelProps & { graph: NoteGraph }) {
  const { tabId, note, readOnly, headingOptions } = props;
  const paneRef = useRef<HTMLDivElement | null>(null);
  const optionsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const shiftHeld = useShiftKeyHeld();
  const spaceHeld = useKeyPress("Space");
  const [focusMode, setFocusMode] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [showMinimap, setShowMinimap] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const graphDocument = useNoteGraphDocument({
    identity: `${note.id}:${tabId}`,
    graph: props.graph,
    onUpdateGraph: props.onUpdateGraph,
    historyBridgeRef: props.historyBridgeRef,
  });
  const { graph, getGraph, history } = graphDocument;
  const { selection, getSelection, select } = useNoteGraphSelection(props);
  const { run, getState, announce, statusMessage, newNodeIds } = useNoteGraphEdits({
    readOnly,
    getGraph,
    commit: graphDocument.commit,
    getSelection,
    select,
  });
  const viewport = useNoteGraphViewport({
    graph,
    getGraph,
    pane: paneRef,
    readOnly,
    persistViewport: graphDocument.persistViewport,
    revealNodeRequest: props.revealNodeRequest,
  });

  const focusPane = useCallback(() => {
    const pane = paneRef.current;
    if (pane && document.activeElement !== pane) pane.focus({ preventScroll: true });
  }, []);
  const selectNode = useCallback(
    (nodeId: string | null) => select({ nodeIds: nodeId ? [nodeId] : [], edgeId: null }),
    [select],
  );
  const showNode = useCallback(
    (nodeId: string) => {
      viewport.revealNode(nodeId);
      selectNode(nodeId);
    },
    [selectNode, viewport],
  );
  /** Opens the details of `nodeId`, or of what is selected when no node is named. */
  const openDetails = useCallback(
    (nodeId?: string) => {
      if (nodeId) selectNode(nodeId);
      setDetailsOpen(true);
    },
    [selectNode],
  );

  const modes = useNoteGraphMode({
    graph,
    readOnly,
    run,
    getGraph,
    getSelection,
    selectNode,
    revealNode: viewport.revealNode,
    announce,
  });
  const { mode, beginTitleEdit, endTitleEdit } = modes;
  const search = useNoteGraphSearch({
    graph,
    inputRef: searchInputRef,
    showNode,
    focusPane,
  });

  /* ---------------- commands ---------------- */

  const nodes = useNoteGraphNodeCommands({
    run,
    getState,
    centerPoint: viewport.centerPoint,
    fitViewSoon: viewport.fitViewSoon,
    beginTitleEdit,
    announce,
    getVideoSeconds: props.getVideoSeconds,
  });
  const { addNodeAt, addNodeInCenter, updateNode, pasteAt, runLayout } = nodes;
  const toggleFocusMode = useCallback(() => {
    setFocusMode(!focusMode);
    announce(focusMode ? "Focus mode off" : "Focus mode on: neighbors stay bright");
  }, [announce, focusMode]);

  /* ---------------- canvas input ---------------- */

  const flow = useNoteGraphFlowBinding({
    readOnly,
    instance: viewport.instance,
    getState,
    run,
    select,
    axisLock: shiftHeld,
    onEditEdgeLabel: modes.editEdgeLabel,
    onMoveEnd: graphDocument.persistViewport,
    announce,
  });
  const gestures = useNoteGraphPaneGestures({
    readOnly,
    touchMarquee: mode.kind === "touchMarquee",
    screenToFlow: viewport.screenToFlow,
    writeTextAt: (point) => {
      // The text's first line starts under the pointer, as clicking into a page does.
      const nodeId = addNodeAt("text", { x: point.x - 10, y: point.y - 14 });
      if (nodeId) beginTitleEdit(nodeId);
    },
    startTouchMarquee: () => {
      modes.startTouchMarquee();
      announce("Selection mode: drag to select, tap empty canvas to exit");
    },
    endTouchMarquee: () => modes.endMode("touchMarquee"),
    focusPane,
  });
  const images = useNoteGraphImages({
    fileInputRef: imageInputRef,
    readOnly,
    getGraph,
    updateNode,
    addNodeAt,
    addNodeInCenter,
    pastePosition: () => gestures.getLastPointer() ?? viewport.centerPoint(),
    pasteNodes: () => pasteAt(gestures.getLastPointer()),
    announce,
  });
  const transfer = useNoteGraphTransfer({
    getGraph,
    run,
    announce,
    revealNodes: viewport.revealNewNodes,
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) =>
    handleNoteGraphKeyDown(
      event,
      mode.kind,
      createNoteGraphKeyCommands({
        run,
        getState,
        getSelection,
        select,
        focusPane,
        toggleFocusMode,
        nodes,
        modes,
        search,
        viewport,
        history,
      }),
    );

  const actionMenu = useNoteGraphActionMenu({
    readOnly,
    getState,
    run,
    select,
    screenToFlowPosition: viewport.screenToFlow,
    canPaste: nodes.canPaste,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undo: history.undo,
    redo: history.redo,
    copy: nodes.copySelection,
    paste: pasteAt,
    fitView: () => viewport.fitView(),
    focusPane,
    beginTitleEdit,
    openDetails,
    startConnect: modes.startConnect,
    editEdgeLabel: modes.editEdgeLabel,
    requestImageUpload: images.requestImageUpload,
    align: (alignMode) => runLayout((state) => ops.alignSelection(state, alignMode)),
    distribute: (axis) => runLayout((state) => ops.distributeSelection(state, axis)),
    announce,
  });

  /* ---------------- what the canvas draws ---------------- */

  const hiddenIds = useMemo(() => findCollapsedFrameHiddenNodeIds(graph.nodes), [graph.nodes]);
  const selectedIds = useMemo(() => new Set(selection.nodeIds), [selection.nodeIds]);
  const { dimmedIds, decorations } = useMemo(
    () =>
      noteGraphDecorations({
        graph,
        filteredOutIds: search.filteredOutIds,
        focusIds: focusMode ? selectedIds : null,
        matchIds: search.matches,
        connectTargetId: modes.connectTargetId,
        newNodeIds,
      }),
    [
      focusMode,
      graph,
      modes.connectTargetId,
      newNodeIds,
      search.filteredOutIds,
      search.matches,
      selectedIds,
    ],
  );
  const flowNodes = useMemo(
    () =>
      toFlowNodes({
        nodes: graph.nodes,
        hiddenIds,
        selectedIds,
        measured: flow.measured,
        transient: flow.transient,
        decorations,
      }),
    [decorations, flow.measured, flow.transient, graph.nodes, hiddenIds, selectedIds],
  );
  const flowEdges = useMemo(() => {
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    return graph.edges.map((edge) =>
      toFlowEdge(edge, {
        selected: edge.id === selection.edgeId,
        hidden: hiddenIds.has(edge.source) || hiddenIds.has(edge.target),
        nodesById,
        dimmed: dimmedIds.has(edge.source) || dimmedIds.has(edge.target),
        lowZoom: viewport.simplifiedEdges,
      }),
    );
  }, [dimmedIds, graph, hiddenIds, selection.edgeId, viewport.simplifiedEdges]);

  const nodeActions = useNoteGraphNodeActions({
    graph,
    readOnly,
    detailsVisible: viewport.detailsVisible,
    run,
    updateNode,
    clearTransientNode: flow.clearTransientNode,
    mode,
    beginTitleEdit,
    endTitleEdit,
    openHeadingManager: modes.openHeadingManager,
    selectNode,
    requestImageUpload: images.requestImageUpload,
    seekVideoTimestamp: props.onSeekVideoTimestamp,
    focusPane,
    openDetails,
  });

  const visibleSelection = ops.selectedNodes({ graph, selection });
  const primaryNode = visibleSelection[0] ?? null;
  const selectedEdge = primaryNode
    ? null
    : (graph.edges.find((edge) => edge.id === selection.edgeId) ?? null);
  const detailsTarget = visibleSelection.length === 1 || selectedEdge;
  const nothingSelected = visibleSelection.length === 0 && !selectedEdge;
  useEffect(() => {
    if (nothingSelected) setDetailsOpen(false);
  }, [nothingSelected]);
  // The toolbar steps aside while nodes move or resize, and in modes that own the canvas.
  const toolbarAnchor =
    flow.transient.size > 0 || (mode.kind !== "idle" && mode.kind !== "editTitle")
      ? null
      : selectionToolbarAnchor({
          selectedNodes: visibleSelection,
          selectedEdge,
          nodes: graph.nodes,
          measured: flow.measured,
        });
  const walkthrough = mode.kind === "walkthrough" ? mode : null;
  const edgeLabelEdit = mode.kind === "editEdgeLabel" ? mode : null;
  const edgeLabelPoint = edgeLabelEdit ? edgeLabelEditorPoint(graph, edgeLabelEdit.edgeId) : null;
  const headingManagerNode =
    mode.kind === "headingManager"
      ? (graph.nodes.find((node) => node.id === mode.nodeId) ?? null)
      : null;
  const preferences = resolveNoteGraphViewPreferences(graph);
  const hintsId = `note-graph-keyboard-hints-${tabId}`;

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const decision = resolveNoteGraphPaneDrop({
      clientX: event.clientX,
      clientY: event.clientY,
      files: Array.from(event.dataTransfer.files),
      hasNode: (nodeId) => graph.nodes.some((node) => node.id === nodeId),
      readOnly,
      screenToFlowPosition: viewport.screenToFlow,
      shapeData: event.dataTransfer.getData(noteGraphShapeDragType),
      targetNodeId:
        event.target instanceof Element
          ? (event.target.closest(".react-flow__node")?.getAttribute("data-id") ?? null)
          : null,
    });
    if (decision.type === "image-on-node") {
      void images.uploadImageForNode(decision.file, decision.nodeId);
    } else if (decision.type === "images-on-canvas") {
      decision.files.forEach((file, index) => {
        void images.uploadImageForNewNode(file, {
          x: decision.position.x + index * 32,
          y: decision.position.y + index * 32,
        });
      });
    } else if (decision.type === "create-node") {
      addNodeAt(decision.shape, decision.position);
    }
  };

  return (
    <NoteGraphNodeActionsContext value={nodeActions}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            {...actionMenu.triggerProps}
            ref={paneRef}
            aria-label="Note graph canvas"
            aria-describedby={hintsId}
            className={cn(
              "relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-(--app-page-region) outline-none",
              preferences.theme !== "default" && `note-graph-theme-${preferences.theme}`,
            )}
            data-note-graph-pane={tabId}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            onDoubleClick={gestures.paneProps.onDoubleClick}
            onKeyDown={handleKeyDown}
            onPaste={images.handlePaste}
            onPointerDownCapture={(event) => {
              if (mode.kind !== "captureSnapshot") gestures.paneProps.onPointerDownCapture(event);
            }}
            onPointerMove={gestures.paneProps.onPointerMove}
            onPointerUp={gestures.paneProps.onPointerUp}
            role="region"
            tabIndex={0}
          >
            <p className="sr-only" id={hintsId}>
              {keyboardHints}
            </p>
            <NoteGraphToolbar
              readOnly={readOnly}
              onAddShape={(shape) => addNodeInCenter(shape)}
              onAddImage={images.addImageNode}
              snapshotCapturing={mode.kind === "captureSnapshot"}
              canCaptureSnapshot={Boolean(viewport.instance)}
              onToggleSnapshotCapture={modes.toggleSnapshotCapture}
              onUndo={() => {
                if (history.undo()) focusPane();
              }}
              onRedo={() => {
                if (history.redo()) focusPane();
              }}
              onAddVideoTimeNode={props.getVideoSeconds ? nodes.addVideoTimeNode : undefined}
              optionsTriggerRef={optionsTriggerRef}
              searchInputRef={searchInputRef}
              options={{
                searchOpen: search.open,
                onOpenSearch: search.openSearch,
                layout: {
                  getGraph,
                  selectionCount: visibleSelection.length,
                  timestampedNodeCount: graph.nodes.filter(
                    (node) => typeof node.timestampSeconds === "number",
                  ).length,
                  applyLayout: (positions, label) =>
                    runLayout((state) => ops.applyLayout(state, positions, label)),
                  tidySelection: () => runLayout(ops.tidySelection),
                  applyTimelineLayout: () => runLayout(ops.applyTimelineLayout),
                  connectPlaybackOrder: () => run(ops.connectPlaybackOrder),
                  colorByCluster: () => run(ops.colorByCluster),
                },
                onInsertTemplate: transfer.insertTemplate,
                onImport: modes.openImport,
                exports: {
                  copyPng: () => void transfer.copyPngImage(),
                  downloadPng: () => void transfer.exportPngFile(),
                  downloadSvg: transfer.exportSvgFile,
                  downloadJsonCanvas: transfer.exportJsonCanvasFile,
                },
                preferences,
                onPreferencesChange: graphDocument.updateViewPreferences,
                showMinimap,
                onShowMinimapChange: setShowMinimap,
                focusMode,
                onToggleFocusMode: toggleFocusMode,
                outlineOpen,
                onToggleOutline: () => setOutlineOpen((open) => !open),
                canStartWalkthrough: graph.nodes.length > 0,
                onStartWalkthrough: () => {
                  modes.startWalkthrough();
                  focusPane();
                },
              }}
            />

            <div className="relative flex min-h-0 flex-1">
              <NoteGraphFlow
                nodes={flowNodes}
                edges={flowEdges}
                initialViewport={graph.viewport}
                readOnly={readOnly}
                preferences={preferences}
                spaceHeld={spaceHeld}
                touchMarquee={mode.kind === "touchMarquee"}
                showMinimap={showMinimap}
                reconnecting={flow.reconnecting}
                flowProps={flow.flowProps}
                onInit={viewport.onInit}
                onMinimapClick={viewport.centerOn}
              />
              {search.open ? (
                <NoteGraphSearchPanel
                  inputRef={searchInputRef}
                  nodeCount={graph.nodes.length}
                  search={search}
                />
              ) : null}
              {mode.kind === "captureSnapshot" && !readOnly ? (
                <NoteGraphSnapshotCapture
                  noteId={note.id}
                  tabId={tabId}
                  pageTabs={note.tabs
                    .filter((tab) => tabKindOf(tab) === "page")
                    .map((tab) => ({ id: tab.id, title: tab.title }))}
                  screenToFlow={viewport.instance ? viewport.screenToFlow : null}
                  onInsert={props.onInsertSnapshot}
                  announce={announce}
                  onClose={() => {
                    modes.endMode("captureSnapshot");
                    focusPane();
                  }}
                />
              ) : null}
              <NoteGraphAlignmentGuides {...flow.guides} />
              {edgeLabelEdit && edgeLabelPoint ? (
                <NoteGraphEdgeLabelEditor
                  at={edgeLabelPoint}
                  draft={edgeLabelEdit.draft}
                  onDraftChange={modes.setEdgeLabelDraft}
                  onCommit={modes.commitEdgeLabel}
                  onCancel={() => modes.endMode("editEdgeLabel")}
                />
              ) : null}
              {toolbarAnchor && primaryNode ? (
                <NoteGraphNodeToolbar
                  anchor={toolbarAnchor}
                  nodes={visibleSelection}
                  readOnly={readOnly}
                  detailsOpen={detailsOpen}
                  onToggleDetails={() => setDetailsOpen((open) => !open)}
                  onPatch={(patch) => run((state) => ops.updateSelectedNodes(state, patch))}
                  onDuplicate={() => run(ops.duplicateSelection)}
                  onConnect={modes.startConnect}
                  onToggleLock={() => run(ops.toggleLockSelection)}
                  onReorder={(order) => run((state) => ops.reorderSelection(state, order))}
                  onAlign={(alignMode) =>
                    runLayout((state) => ops.alignSelection(state, alignMode))
                  }
                  onDistribute={(axis) =>
                    runLayout((state) => ops.distributeSelection(state, axis))
                  }
                  onDelete={() => run(ops.deleteSelection)}
                />
              ) : toolbarAnchor && selectedEdge ? (
                <NoteGraphEdgeToolbar
                  anchor={toolbarAnchor}
                  edge={selectedEdge}
                  readOnly={readOnly}
                  detailsOpen={detailsOpen}
                  onToggleDetails={() => setDetailsOpen((open) => !open)}
                  onChange={(patch) =>
                    run((state) => ops.updateEdge(state, selectedEdge.id, patch))
                  }
                  onDelete={() => run(ops.deleteSelection)}
                />
              ) : null}
              {outlineOpen || (detailsOpen && detailsTarget) ? (
                <div className="pointer-events-none absolute bottom-3 right-3 top-3 z-30 flex w-[min(20rem,calc(100%-1.5rem))] flex-col items-stretch gap-2 [&>*]:pointer-events-auto">
                  {outlineOpen ? (
                    <NoteGraphOutline
                      nodes={graph.nodes}
                      selectedIds={selectedIds}
                      onPick={showNode}
                      onClose={() => setOutlineOpen(false)}
                    />
                  ) : null}
                  {detailsOpen && primaryNode && visibleSelection.length === 1 ? (
                    <NoteGraphInspector
                      onClose={() => setDetailsOpen(false)}
                      node={{
                        node: primaryNode,
                        readOnly,
                        onChange: (patch, historyGroup) =>
                          updateNode(primaryNode.id, patch, historyGroup),
                        onRequestImage: () => images.requestImageUpload(primaryNode.id),
                        frameMemberCount: nodeActions.frameMemberCount(primaryNode.id),
                        onToggleFrame: () =>
                          run((state) => ops.toggleFrameCollapsed(state, primaryNode.id)),
                        onSyncTitleFromHeading: () =>
                          run((state) =>
                            ops.syncTitleFromHeading(state, primaryNode.id, headingOptions),
                          ),
                        onMatchHeadingColor: () =>
                          run((state) =>
                            ops.matchHeadingColor(state, primaryNode.id, headingOptions),
                          ),
                        onManageHeadings: () => nodeActions.openHeadingConnections(primaryNode.id),
                      }}
                    />
                  ) : detailsOpen && selectedEdge ? (
                    <NoteGraphInspector
                      onClose={() => setDetailsOpen(false)}
                      edge={{
                        edge: selectedEdge,
                        readOnly,
                        onChange: (patch, historyGroup) =>
                          run(
                            (state) => ops.updateEdge(state, selectedEdge.id, patch),
                            historyGroup,
                          ),
                      }}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>

            <NoteGraphWarnings
              nodeCount={graph.nodes.length}
              loopCount={countNoteGraphCycleEdges(graph.nodes, graph.edges)}
            />

            <NoteGraphZoomControls
              zoomPct={viewport.zoomPct}
              canZoomToSelection={visibleSelection.length > 0}
              onZoomIn={viewport.zoomIn}
              onZoomOut={viewport.zoomOut}
              onZoomTo100={viewport.zoomTo100}
              onFitView={() => {
                viewport.fitView();
                focusPane();
              }}
              onZoomToSelection={() => {
                viewport.zoomToNodes(visibleSelection);
                focusPane();
              }}
            />

            <NoteGraphBottomStack>
              {walkthrough ? (
                <NoteGraphWalkthroughBar
                  index={walkthrough.index}
                  total={walkthrough.order.length}
                  title={
                    graph.nodes.find((node) => node.id === walkthrough.order[walkthrough.index])
                      ?.title ?? ""
                  }
                  onStep={modes.stepWalkthrough}
                  onExit={() => modes.endMode("walkthrough")}
                />
              ) : null}
              <NoteGraphStatus message={statusMessage} />
            </NoteGraphBottomStack>
            {mode.kind === "touchMarquee" ? (
              <NoteGraphChip className="top-3">
                Selection mode. Drag to select, tap empty canvas to exit
              </NoteGraphChip>
            ) : null}

            {mode.kind === "import" ? (
              <NoteGraphImportDialog
                format={mode.format}
                getGraph={getGraph}
                onImport={transfer.insertImport}
                onClose={() => modes.endMode("import")}
                returnFocusRef={optionsTriggerRef}
              />
            ) : null}

            <HeadingConnectionManager
              headingOptions={headingOptions}
              onOpenChange={(open) => {
                if (!open) modes.endMode("headingManager");
              }}
              onOpenHeading={props.onOpenHeading}
              onToggleHeading={(headingBlockId) => {
                if (headingManagerNode) {
                  props.onToggleHeadingConnection(headingManagerNode.id, headingBlockId);
                }
              }}
              open={Boolean(headingManagerNode)}
              readOnly={readOnly}
              selectedHeadingBlockIds={headingManagerNode?.headingBlockIds ?? []}
              targetLabel={headingManagerNode?.title || "Untitled node"}
            />

            {!readOnly ? (
              <input
                accept={imageInputAccept}
                aria-hidden="true"
                className="hidden"
                data-testid="note-graph-image-input"
                onChange={images.handleImageFileChange}
                ref={imageInputRef}
                tabIndex={-1}
                type="file"
              />
            ) : null}
          </div>
        </ContextMenuTrigger>
        <ActionMenuContent aria-label="Graph actions">
          {actionMenu.context ? (
            <NoteGraphMenu context={actionMenu.context} run={actionMenu.run} />
          ) : null}
        </ActionMenuContent>
      </ContextMenu>
    </NoteGraphNodeActionsContext>
  );
}

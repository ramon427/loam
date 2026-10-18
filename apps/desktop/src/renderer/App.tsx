import { LazyMotion, domAnimation } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AiChatSide, AiChatToggleProvider } from "./ai/AiChatPanel";
import { useAiChatLayout } from "./ai/useAiChatLayout";
import { CommandPalette, type AppCommand } from "./commands/CommandPalette";
import { ExportDialog } from "./import-export/ExportDialog";
import { OpenedFileView } from "./files/OpenedFileView";
import { useOpenedFiles } from "./files/useOpenedFiles";
import { NoteHistoryDialog } from "./history/NoteHistoryDialog";
import { pluginHost } from "./plugins/host";
import {
  PluginPanes,
  PluginPromptDialog,
  PluginShortcuts,
  PluginView,
} from "./plugins/PluginPanes";
import { PluginSlot } from "./plugins/PluginSlot";
import { NotesSidebarCreateActions } from "./sidebar/NotesSidebarCreateActions";
import { NotesSidebarFilter } from "./sidebar/NotesSidebarFilter";
import { NotesSidebar } from "./sidebar/NotesSidebar";
import { scopedProjectOf, type NotesProjectScope } from "./sidebar/notesTreeModel";
import { NotesTrashButton } from "./sidebar/NotesTrashButton";
import { NotesTreeCommandsProvider, useNotesTreeCommands } from "./sidebar/useNotesTreeCommands";
import { KeyboardShortcutsScope, useShortcuts, type Shortcut } from "./keyboard/useShortcuts";
import { NotesWorkspaceProvider, useNotesWorkspace } from "./workspace/NotesWorkspace";
import { createFileNoteDocument } from "./workspace/noteDocuments";
import { Toaster } from "./ui/Toaster";
import { Tooltips } from "./ui/Tooltips";

import { NotesScreen } from "./note/NotesScreen";
import { NotesSearch } from "./search/NotesSearch";
import { NoteFindBar, type NoteFindBarHandle } from "./search/NoteFindBar";
import { UnlockGate } from "./security/UnlockGate";
import { useAiChatStatus } from "./settings/queries";
import { SettingsButton, SettingsScreen, type SettingsSectionId } from "./settings/SettingsScreen";
import { SidebarUpdateButton } from "./shell/SidebarUpdateButton";
import { SidebarToggle, SidebarToggleSlot, useWindowControlsTheme } from "./shell/WindowChrome";
import { useSidebarLayout } from "./shell/useSidebarLayout";

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      // Reads are local IPC calls: failures are real errors, not flaky networks.
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
    },
  });

function Workspace() {
  const workspace = useNotesWorkspace();
  const { createNote, requestMove } = useNotesTreeCommands();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // Plugins run while the library is open: this screen only shows once notes are unlocked.
  useEffect(() => pluginHost.start(), []);
  const findBarRef = useRef<NoteFindBarHandle>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const openSettings = useCallback(() => {
    if (settingsOpen) {
      document.getElementById("settings-search-input")?.focus();
      return;
    }
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSettingsOpen(true);
  }, [settingsOpen]);
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setSettingsSection(undefined);
    requestAnimationFrame(() => {
      const previous = previousFocusRef.current;
      if (previous?.isConnected && previous.getClientRects().length > 0)
        previous.focus({ preventScroll: true });
      else document.getElementById("main-content")?.focus({ preventScroll: true });
    });
  }, []);
  const {
    collapsed: sidebarCollapsed,
    width: sidebarWidth,
    resizing: sidebarResizing,
    sidebarRef,
    resizeRef,
    toggleRef: sidebarToggleRef,
    toggle: toggleSidebar,
    style: sidebarStyle,
    resizeHandleProps,
  } = useSidebarLayout();
  const chatStatus = useAiChatStatus().data;
  const chatEnabled = chatStatus?.enabled === true;
  const chatLayout = useAiChatLayout(sidebarWidth);
  const chatOpen = chatEnabled && chatLayout.open;
  const chatToggle = useMemo(
    () => (chatEnabled ? { open: chatOpen, onOpen: chatLayout.openPanel } : null),
    [chatEnabled, chatOpen, chatLayout.openPanel],
  );
  const shellStyle = {
    ...sidebarStyle,
    "--loam-chat-width": `${chatOpen ? chatLayout.width : 0}px`,
  } as CSSProperties;
  const activeNote = useMemo(() => {
    const note = workspace.notes.find((candidate) => candidate.id === workspace.activeNoteId);
    return note ? { id: note.id, title: note.title } : null;
  }, [workspace.notes, workspace.activeNoteId]);
  const [requestedFolderScopeId, setFolderScopeId] = useState<string | null | undefined>();
  const folderScopeId =
    requestedFolderScopeId &&
    !workspace.folders.some((folder) => folder.id === requestedFolderScopeId)
      ? undefined
      : requestedFolderScopeId;
  const [requestedProjectScope, setProjectScope] = useState<NotesProjectScope>();
  // Projects removed meanwhile drop out of the choice; with none left, everything shows.
  const projectScope = useMemo(() => {
    if (!requestedProjectScope) return undefined;
    const kept = [...requestedProjectScope].filter(
      (projectId) =>
        projectId === null || workspace.projects.some((project) => project.id === projectId),
    );
    return kept.length > 0 ? new Set(kept) : undefined;
  }, [requestedProjectScope, workspace.projects]);
  const scopedProjectId = scopedProjectOf(projectScope);
  const newNotePlace = useMemo(
    () => ({ folderId: folderScopeId ?? undefined, projectId: scopedProjectId }),
    [folderScopeId, scopedProjectId],
  );
  const showEverything = useCallback(() => {
    setFolderScopeId(undefined);
    setProjectScope(undefined);
  }, []);
  const libraryUnavailable = workspace.isLoading || Boolean(workspace.loadError);
  const openedFiles = useOpenedFiles({ enabled: !libraryUnavailable });
  const { pick: pickFile } = openedFiles;
  const shortcuts = useMemo(() => {
    const focusSearch = () => document.getElementById("notes-search-input")?.focus();
    return [
      { id: "app.settings", allowInEditable: true, run: openSettings },
      { id: "app.sidebar.toggle", enabled: !settingsOpen, run: toggleSidebar },
      {
        id: "app.chat.toggle",
        enabled: chatEnabled && !settingsOpen,
        allowInEditable: true,
        run: chatLayout.toggle,
      },
      {
        id: "app.note.new",
        enabled: !settingsOpen && !libraryUnavailable,
        allowInEditable: true,
        run: () => void createNote(newNotePlace),
      },
      {
        id: "app.file.open",
        enabled: !settingsOpen && !libraryUnavailable,
        allowInEditable: true,
        run: () => void pickFile(),
      },
      {
        id: "app.notes.search",
        enabled: !settingsOpen,
        allowInEditable: true,
        run: focusSearch,
      },
      {
        id: "app.commands",
        enabled: !settingsOpen,
        allowInEditable: true,
        run: () => setPaletteOpen(true),
      },
      {
        id: "entry.find",
        enabled: !settingsOpen,
        allowInEditable: true,
        run: () => (workspace.activeNoteId ? findBarRef.current?.find() : focusSearch()),
      },
    ] satisfies Shortcut[];
  }, [
    chatEnabled,
    chatLayout.toggle,
    createNote,
    libraryUnavailable,
    newNotePlace,
    openSettings,
    pickFile,
    settingsOpen,
    toggleSidebar,
    workspace.activeNoteId,
  ]);
  useShortcuts(shortcuts);
  const appCommands = useMemo<AppCommand[]>(
    () => [
      { id: "app.note.new", title: "New note", run: () => void createNote(newNotePlace) },
      { id: "app.file.open", title: "Open a file…", run: () => void pickFile() },
      { id: "app.settings", title: "Open settings", run: openSettings },
      { id: "app.sidebar.toggle", title: "Toggle sidebar", run: toggleSidebar },
      ...(workspace.activeNoteId
        ? [
            {
              id: "app.note.move",
              title: "Move to…",
              run: () => requestMove([{ kind: "note" as const, id: workspace.activeNoteId! }]),
            },
          ]
        : []),
      { id: "app.export", title: "Export…", run: () => setExportOpen(true) },
    ],
    [
      createNote,
      newNotePlace,
      openSettings,
      pickFile,
      requestMove,
      toggleSidebar,
      workspace.activeNoteId,
    ],
  );
  useWindowControlsTheme();

  return (
    <div className="loam-window">
      <KeyboardShortcutsScope enabled={!settingsOpen}>
        <div
          className="loam-shell app-shell-theme"
          style={shellStyle}
          data-sidebar-collapsed={sidebarCollapsed}
          data-sidebar-resizing={sidebarResizing}
          data-chat-open={chatOpen}
          data-chat-resizing={chatOpen && chatLayout.resizing}
          hidden={settingsOpen}
          inert={settingsOpen}
        >
          <SidebarToggle
            ref={sidebarToggleRef}
            expanded={!sidebarCollapsed}
            onToggle={toggleSidebar}
          />
          <aside
            id="notes-sidebar"
            ref={sidebarRef}
            className="loam-sidebar"
            aria-label="Notes library"
            hidden={sidebarCollapsed}
          >
            <div className="loam-chrome-row loam-sidebar-titlebar">
              <SidebarToggleSlot />
              <span className="loam-app-name">Loam</span>
              <div className="loam-sidebar-actions">
                <NotesSidebarFilter
                  projects={workspace.projects}
                  folders={workspace.folders}
                  projectScope={projectScope}
                  folderScopeId={folderScopeId}
                  onProjectScopeChange={setProjectScope}
                  onFolderScopeChange={setFolderScopeId}
                  disabled={libraryUnavailable}
                />
                <NotesSidebarCreateActions
                  disabled={libraryUnavailable}
                  folderId={folderScopeId}
                  projectId={scopedProjectId}
                  onCreateFolder={() => {
                    // A new folder must land where the sidebar shows it.
                    setFolderScopeId(undefined);
                    if (!scopedProjectId) setProjectScope(undefined);
                  }}
                />
              </div>
            </div>
            <div className="loam-sidebar-body">
              <div className="loam-sidebar-tree">
                <NotesSidebar
                  folderScopeId={folderScopeId}
                  projectScope={projectScope}
                  onOpenHistory={(note) =>
                    workspace.openHistory({ noteId: note.id, title: note.title })
                  }
                />
              </div>
              <PluginSlot name="sidebar.footer" props={{}} className="px-1" />
              <div className="loam-sidebar-footer">
                <SettingsButton onOpen={openSettings} />
                <NotesTrashButton onRestore={showEverything} />
                <SidebarUpdateButton />
              </div>
            </div>
          </aside>
          <div ref={resizeRef} className="loam-sidebar-resize" {...resizeHandleProps}>
            <span id="sidebar-resize-hint" className="sr-only">
              Use the arrow keys to resize, or hold Shift for larger steps. Home and End set the
              minimum and maximum width. Enter collapses the sidebar. Escape cancels a drag.
            </span>
          </div>
          <AiChatToggleProvider value={chatToggle}>
            <main id="main-content" className="loam-main" tabIndex={-1}>
              <NoteFindBar ref={findBarRef} />
              <NotesScreen onCreateNote={() => void createNote(newNotePlace)} />
              {openedFiles.current ? (
                <OpenedFileView
                  // Each opened file starts the viewer over.
                  key={JSON.stringify(openedFiles.current.file.source)}
                  opened={openedFiles.current}
                  onClose={openedFiles.close}
                  onKeep={({ kind, file }) => {
                    openedFiles.close();
                    void workspace.createNote(newNotePlace, createFileNoteDocument(kind, file));
                  }}
                />
              ) : null}
              <PluginView />
              <PluginPanes />
              <NotesSearch
                onOpen={showEverything}
                onFind={(noteId, query) => findBarRef.current?.find({ noteId, query })}
              />
            </main>
          </AiChatToggleProvider>
          {chatStatus?.enabled ? (
            <AiChatSide
              layout={chatLayout}
              status={chatStatus}
              activeNote={activeNote}
              notes={workspace.notes}
              onOpenNote={workspace.openNote}
              onOpenSettings={() => {
                setSettingsSection("ai-chat");
                openSettings();
              }}
            />
          ) : null}
          <PluginShortcuts enabled={!settingsOpen} />
          <PluginPromptDialog />
        </div>
      </KeyboardShortcutsScope>
      <SettingsScreen open={settingsOpen} section={settingsSection} onClose={closeSettings} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} appCommands={appCommands} />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
      {workspace.historyTarget ? (
        <NoteHistoryDialog
          target={workspace.historyTarget}
          onClose={() => workspace.openHistory(null)}
          onRestored={workspace.reloadNote}
        />
      ) : null}
    </div>
  );
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domAnimation}>
        {/* Before the app, so it listens before anything shows a toast on startup. */}
        <Toaster />
        <Tooltips />
        {/* Encrypted notes: nothing reads them, not even saved drafts, until they are unlocked. */}
        <UnlockGate>
          <NotesWorkspaceProvider>
            <NotesTreeCommandsProvider>
              <Workspace />
            </NotesTreeCommandsProvider>
          </NotesWorkspaceProvider>
        </UnlockGate>
      </LazyMotion>
    </QueryClientProvider>
  );
}

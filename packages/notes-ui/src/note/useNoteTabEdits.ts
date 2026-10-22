import { removeBrokenHeadingConnections } from "@loam/shared/notes/headingConnections";
import {
  isFileTabKind,
  tabKindOf,
  type ConvertibleTabKind,
  type FileTabKind,
  type NoteGraph,
  type NoteTabKind,
  type NoteTable,
} from "@loam/shared/notes/noteModel";
import { callBridge } from "../host/notesHost";
import { toggleNoteHeadingConnection } from "../editor/noteHeadingConnections";
import type { NoteTableSelection } from "../table/NoteTablePanel";
import { toastError } from "../ui/toast";
import type { NoteContentPatch } from "../workspace/NotesWorkspace";
import type { NoteDocument } from "../workspace/types";

import {
  addFileTab,
  addTab,
  changeTabKind,
  deleteTab,
  MAX_TABS,
  moveTab,
  renameTab,
} from "./noteTabs";
import { needsMarkdownParser } from "./tabConversions";

type Update = (change: NoteContentPatch | ((latest: NoteDocument) => NoteContentPatch)) => void;

/**
 * Changes to a note's tabs and to what its graph and table tabs hold. A tab
 * that is added or changes kind starts with its first node or column selected.
 */
export function useNoteTabEdits({
  note,
  update,
  selectGraphNode,
  selectTableTarget,
}: {
  note: NoteDocument;
  update: Update;
  /** Selects a node of the graph in view, or none. */
  selectGraphNode: (nodeId: string | null) => void;
  selectTableTarget: (target: NoteTableSelection | null) => void;
}) {
  const runTabChange = (change: (latest: NoteDocument) => NoteContentPatch | null) => {
    let patch: NoteContentPatch | null = null;
    update((latest) => {
      patch = change(latest);
      return patch ?? {};
    });
    return patch as NoteContentPatch | null;
  };

  /** Selects what a graph or table tab starts with, once the tab shows. */
  const selectFirstTarget = (patch: NoteContentPatch | null, tabId: string | undefined) => {
    if (!patch || !tabId) return;
    const graph = patch.graphsByTab?.[tabId];
    const table = patch.tablesByTab?.[tabId];
    selectGraphNode(graph?.nodes[0]?.id ?? null);
    selectTableTarget(
      table?.columns[0] ? { tabId, kind: "column", id: table.columns[0].id } : null,
    );
  };

  const showAddedTab = (patch: NoteContentPatch | null) => {
    if (!patch) toastError(`Editor tabs are limited to ${MAX_TABS}.`);
    selectFirstTarget(patch, patch?.activeTabId);
  };

  // A file tab is added once its file is in: picked and copied in, or new Markdown the note holds.
  const addFileTabOfKind = async (kind: FileTabKind) => {
    if (note.tabs.length >= MAX_TABS) return showAddedTab(null);
    try {
      const file =
        kind === "markdown"
          ? { name: "Untitled.md", source: { kind: "text" as const, text: "" } }
          : await callBridge("files.import", { kind });
      if (file) showAddedTab(runTabChange((latest) => addFileTab(latest, kind, file)));
    } catch (error) {
      console.error(error);
      toastError(error instanceof Error ? error.message : "Couldn't add the file.");
    }
  };

  const addTabOfKind = (kind: NoteTabKind) => {
    if (isFileTabKind(kind)) void addFileTabOfKind(kind);
    else showAddedTab(runTabChange((latest) => addTab(latest, kind)));
  };

  const changeKind = (tabId: string, kind: ConvertibleTabKind) => {
    const tab = note.tabs.find((candidate) => candidate.id === tabId);
    // Markdown becomes blocks with BlockNote's parser, loaded only for that.
    const parser =
      tab && needsMarkdownParser(tabKindOf(tab), kind)
        ? import("../editor/blockParsers").then((module) => module.parseMarkdown)
        : Promise.resolve(null);
    void parser.then((parseMarkdown) =>
      selectFirstTarget(
        runTabChange((latest) => changeTabKind(latest, tabId, kind, parseMarkdown)),
        tabId,
      ),
    );
  };

  const updateGraph = (tabId: string, graph: NoteGraph | null) => {
    if (!graph) selectGraphNode(null);
    update((latest) => {
      const graphsByTab = { ...latest.graphsByTab };
      if (graph) graphsByTab[tabId] = graph;
      else delete graphsByTab[tabId];
      // Graph history can bring back links to headings deleted since.
      return {
        graphsByTab: removeBrokenHeadingConnections({ ...latest, graphsByTab }).graphsByTab,
      };
    });
  };

  const updateTable = (tabId: string, table: NoteTable) =>
    update((latest) => {
      const tablesByTab = { ...latest.tablesByTab, [tabId]: table };
      return {
        tablesByTab: removeBrokenHeadingConnections({ ...latest, tablesByTab }).tablesByTab,
      };
    });

  const toggleNodeHeading = (nodeId: string, headingBlockId: string) =>
    update((latest) => {
      const tabId = Object.entries(latest.graphsByTab ?? {}).find(([, graph]) =>
        graph.nodes.some((node) => node.id === nodeId),
      )?.[0];
      return tabId
        ? toggleNoteHeadingConnection(
            latest,
            { kind: "graph-node", tabId, targetId: nodeId },
            headingBlockId,
          )
        : {};
    });

  const toggleTableHeading = (target: NoteTableSelection, headingBlockId: string) =>
    update((latest) =>
      toggleNoteHeadingConnection(
        latest,
        {
          kind: target.kind === "row" ? "table-row" : "table-column",
          tabId: target.tabId,
          targetId: target.id,
        },
        headingBlockId,
      ),
    );

  return {
    addTab: addTabOfKind,
    changeKind,
    renameTab: (tabId: string, title: string) => {
      runTabChange((latest) => renameTab(latest, tabId, title));
    },
    deleteTab: (tabId: string) => {
      runTabChange((latest) => deleteTab(latest, tabId));
    },
    moveTab: (tabId: string, targetId: string, half: Parameters<typeof moveTab>[3]) => {
      runTabChange((latest) => moveTab(latest, tabId, targetId, half));
    },
    updateGraph,
    updateTable,
    toggleNodeHeading,
    toggleTableHeading,
  };
}

export type NoteTabEdits = ReturnType<typeof useNoteTabEdits>;

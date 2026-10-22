// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { describe, expect, it, vi } from "vitest";
import {
  NoteGraphSnapshotContext,
  NoteGraphSnapshotContent,
  graphSnapshotBlockSpec,
} from "../NoteGraphSnapshotBlock";
import { installFakeBridge } from "../../testing/fakeBridge";
import type { NoteDocument } from "../../workspace/types";

vi.mock("../../media/useImageUrl", () => ({
  useImageUrl: () => ({ url: "https://example.test/node.png" }),
}));

const snapshot = { noteId: "source", tabId: "graph", x: -20, y: -30, width: 400, height: 200 };
const source: NoteDocument = {
  id: "source",
  title: "Source",
  updatedAt: "2026-10-11T00:00:00Z",
  activeTabId: "text",
  tabs: [
    { id: "text", title: "Notes" },
    { id: "graph", title: "Ideas", kind: "graph" },
  ],
  blocksByTab: { text: [], graph: [] },
  graphsByTab: {
    graph: {
      enabled: true,
      nodes: [
        {
          id: "idea",
          title: "Original idea",
          notes: "Details",
          position: { x: 20, y: 20 },
          size: { width: 100, height: 80 },
        },
      ],
      edges: [],
    },
  },
};

const { invoke } = installFakeBridge({ "notes.get": () => source });

describe("live read-only snapshot blocks", () => {
  it("uses current graph edits without refetching or embedding another editor", () => {
    const client = new QueryClient();
    const onOpenSource = vi.fn();
    const view = (note: NoteDocument) => (
      <QueryClientProvider client={client}>
        <NoteGraphSnapshotContext value={{ note, onOpenSource }}>
          <NoteGraphSnapshotContent props={snapshot} />
        </NoteGraphSnapshotContext>
      </QueryClientProvider>
    );
    const { container, rerender } = render(view(source));
    expect(
      screen.getByRole("img", { name: "Live snapshot of Ideas" }).getAttribute("viewBox"),
    ).toBe("-20 -30 400 200");
    expect(screen.getByText("Original idea")).toBeTruthy();
    expect(screen.getByText("Details")).toBeTruthy();
    expect(container.querySelector("[data-graph-snapshot]")?.getAttribute("contenteditable")).toBe(
      "false",
    );
    expect(container.querySelector(".react-flow")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open source graph" }));
    expect(onOpenSource).toHaveBeenCalledWith(snapshot);
    rerender(
      view({
        ...source,
        graphsByTab: {
          graph: {
            ...source.graphsByTab!.graph!,
            nodes: [{ ...source.graphsByTab!.graph!.nodes[0]!, title: "Changed idea" }],
          },
        },
      }),
    );
    expect(screen.getByText("Changed idea")).toBeTruthy();
    expect(screen.queryByText("Original idea")).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    rerender(view({ ...source, graphsByTab: {} }));
    expect(screen.getByText("The source graph is no longer available.")).toBeTruthy();
  });

  it("shares one cached source between multiple snapshots and reacts to source updates and deletion", async () => {
    const client = new QueryClient();
    const destination = { ...source, id: "destination", graphsByTab: {} };
    render(
      <QueryClientProvider client={client}>
        <NoteGraphSnapshotContext value={{ note: destination }}>
          <NoteGraphSnapshotContent props={snapshot} />
          <NoteGraphSnapshotContent props={snapshot} />
        </NoteGraphSnapshotContext>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getAllByText("Original idea")).toHaveLength(2));
    expect(invoke).toHaveBeenCalledTimes(1);
    act(() =>
      client.setQueryData(["note", "source"], {
        ...source,
        graphsByTab: {
          graph: {
            ...source.graphsByTab!.graph!,
            nodes: [{ ...source.graphsByTab!.graph!.nodes[0]!, title: "Synced idea" }],
          },
        },
      }),
    );
    await waitFor(() => expect(screen.getAllByText("Synced idea")).toHaveLength(2));
    act(() => client.setQueryData(["note", "source"], null));
    await waitFor(() =>
      expect(screen.getAllByText("The source graph is no longer available.")).toHaveLength(2),
    );
    act(() => client.setQueryData(["note", "source"], source));
    await waitFor(() => expect(screen.getAllByText("Original idea")).toHaveLength(2));
  });

  it("round-trips the custom block through BlockNote JSON and clipboard HTML", () => {
    const schema = BlockNoteSchema.create({
      blockSpecs: { ...defaultBlockSpecs, graphSnapshot: graphSnapshotBlockSpec() },
    });
    const editor = BlockNoteEditor.create({
      schema,
      initialContent: [{ type: "graphSnapshot", props: snapshot }],
    });
    expect(editor.document[0]!.type).toBe("graphSnapshot");
    expect(editor.document[0]!.props).toEqual(snapshot);
    const html = editor.blocksToHTMLLossy(editor.document);
    expect(html).toContain("data-loam-graph-snapshot");
    const parsed = editor.tryParseHTMLToBlocks(html);
    expect(parsed[0]!.type).toBe("graphSnapshot");
    expect(parsed[0]!.props).toEqual(snapshot);
    editor._tiptapEditor.destroy();
  });
});

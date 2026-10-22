// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installFakeBridge } from "../../testing/fakeBridge";

const waitMock = vi.hoisted(() => ({ saved: true }));
vi.mock("../../workspace/saveAllNoteEdits", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  saveAllNoteEdits: async () => waitMock.saved,
}));

import { NoteHistoryDialog } from "../NoteHistoryDialog";

const NOTE = "00000000-0000-4000-8000-000000000001";
const versionDocument = (body: string) => ({
  title: "Plan",
  activeTabId: "t1",
  tabs: [{ id: "t1", title: "Notes", kind: "page" }],
  blocksByTab: {
    t1: [
      {
        id: "b1",
        type: "paragraph",
        props: {},
        content: [{ type: "text", text: body, styles: {} }],
        children: [],
      },
    ],
  },
});

/** Shows the dialog for NOTE until it closes itself. */
function OpenHistory({ onRestored }: { onRestored: (noteId: string) => void }) {
  const [open, setOpen] = useState(true);
  return open ? (
    <NoteHistoryDialog
      target={{ noteId: NOTE, title: "Plan" }}
      onClose={() => setOpen(false)}
      onRestored={onRestored}
    />
  ) : null;
}

const renderHistory = (
  versions = [
    { id: "v2", savedAt: Date.UTC(2026, 9, 10, 9), title: "Plan", sizeBytes: 2048 },
    { id: "v1", savedAt: Date.UTC(2026, 9, 9, 9), title: "Old plan", sizeBytes: 1024 },
  ],
) => {
  const { invoke } = installFakeBridge({
    "notes.history": () => ({ versions }),
    "notes.version": ({ versionId }: { versionId: string }) => ({
      savedAt: 0,
      note: versionDocument(`Body of ${versionId}`),
    }),
  });
  const onRestored = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OpenHistory onRestored={onRestored} />
    </QueryClientProvider>,
  );
  return { invoke, onRestored };
};

// The app sets the theme on <html> before it renders; the preview's editor follows it.
beforeEach(() => {
  document.documentElement.dataset.theme = "light";
});

afterEach(() => {
  waitMock.saved = true;
});

describe("NoteHistoryDialog", () => {
  it("lists a note's versions and previews the one picked", async () => {
    renderHistory();
    const list = await screen.findByRole("list", { name: "Versions" });
    const buttons = await within(list).findAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      expect.stringContaining("2 KB"),
      expect.stringContaining("Old plan · 1 KB"),
    ]);
    expect(await screen.findByText("Body of v2")).toBeTruthy();
    fireEvent.click(buttons[1]!);
    expect(await screen.findByText("Body of v1")).toBeTruthy();
  });

  it("restores the picked version and has the open note read again", async () => {
    const { invoke, onRestored } = renderHistory();
    await screen.findByText("Body of v2");
    fireEvent.click(screen.getByRole("button", { name: /Restore this version/ }));
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(NOTE));
    expect(invoke).toHaveBeenCalledWith("notes.restoreVersion", { noteId: NOTE, versionId: "v2" });
    expect(screen.queryByRole("dialog", { name: "Version history" })).toBeNull();
  });

  it("does not restore while edits are unsaved", async () => {
    waitMock.saved = false;
    const { invoke, onRestored } = renderHistory();
    await screen.findByText("Body of v2");
    fireEvent.click(screen.getByRole("button", { name: /Restore this version/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Restore this version/ })).toHaveProperty(
        "disabled",
        false,
      ),
    );
    expect(invoke).not.toHaveBeenCalledWith("notes.restoreVersion", expect.anything());
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("explains when there is no history yet", async () => {
    renderHistory([]);
    expect(await screen.findByText(/No earlier versions yet/)).toBeTruthy();
  });
});

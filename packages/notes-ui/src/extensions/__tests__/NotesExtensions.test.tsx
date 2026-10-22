// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CommandPalette } from "../../commands/CommandPalette";
import { renderSidebar, stubTreeViewport } from "../../sidebar/__tests__/notesSidebarHarness";
import { NotesExtensionsProvider, NotesMainHeader, NotesSlot } from "../NotesExtensions";

stubTreeViewport();

describe("notes extensions", () => {
  it("lists the app's commands in the command palette, with where they come from", () => {
    render(
      <NotesExtensionsProvider
        value={{
          useCommands: () => [
            { id: "trades.open", title: "Open trades", detail: "Measure", run: vi.fn() },
          ],
        }}
      >
        <CommandPalette open onOpenChange={() => undefined} appCommands={[]} />
      </NotesExtensionsProvider>,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Search commands" }), {
      target: { value: "trades" },
    });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Open tradesMeasure",
    ]);
  });

  it("draws the app's slots and header, and nothing without them", () => {
    const { rerender } = render(
      <NotesExtensionsProvider value={{}}>
        <NotesMainHeader>
          <span>Title</span>
        </NotesMainHeader>
        <NotesSlot name="note.header" props={{ noteId: "n" }} />
      </NotesExtensionsProvider>,
    );
    expect(screen.getByText("Title")).toBeTruthy();
    expect(screen.queryByTestId("slot")).toBeNull();

    rerender(
      <NotesExtensionsProvider
        value={{
          Slot: ({ name, props }) => (
            <span data-testid="slot">{`${name} ${String(props.noteId)}`}</span>
          ),
          MainHeader: ({ children }) => <div data-testid="header">{children}</div>,
        }}
      >
        <NotesMainHeader>
          <span>Title</span>
        </NotesMainHeader>
        <NotesSlot name="note.header" props={{ noteId: "n" }} />
      </NotesExtensionsProvider>,
    );
    expect(screen.getByTestId("slot").textContent).toBe("note.header n");
    expect(screen.getByTestId("header").textContent).toBe("Title");
  });

  it("opens a note only once the app allows it", async () => {
    let allow: (deny: string | undefined) => void = () => undefined;
    const beforeOpenNote = vi.fn(
      () =>
        new Promise<string | undefined>((resolve) => {
          allow = resolve;
        }),
    );
    const sidebar = await renderSidebar({ activeNoteId: null, extensions: { beforeOpenNote } });

    sidebar.openNote("root-first");
    expect(beforeOpenNote).toHaveBeenCalledWith("root-first");
    expect(sidebar.activeNoteId()).toBeNull();
    await act(async () => allow("Locked by the app"));
    expect(sidebar.activeNoteId()).toBeNull();

    sidebar.openNote("root-first");
    await act(async () => allow(undefined));
    expect(sidebar.activeNoteId()).toBe("root-first");
  });
});

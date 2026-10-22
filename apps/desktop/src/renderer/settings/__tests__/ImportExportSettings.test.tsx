// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@loam/notes-ui/workspace/saveAllNoteEdits", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  saveAllNoteEdits: async () => true,
}));
vi.mock("@loam/notes-ui/workspace/NotesWorkspace", () => ({
  useNotesWorkspace: () => ({
    reloadLibrary: () => undefined,
    notes: [{ id: "n1", title: "Plan" }],
    activeNoteId: "n1",
  }),
}));
const toasts = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));
vi.mock("@loam/notes-ui/ui/toast", () => toasts);

import { installFakeBridge } from "@loam/notes-ui/testing/fakeBridge";
import { ImportExportSettings } from "../ImportExportSettings";

const renderSection = () => {
  const bridge = installFakeBridge({
    "import.pick": () => ({ status: "canceled" }),
    "import.pickDropped": () => ({ status: "canceled" }),
    "security.status": () => ({ state: "off" }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ImportExportSettings />
    </QueryClientProvider>,
  );
  return bridge;
};

/** Drops `files` on the import section, as the system sends them. */
const dropFiles = async (files: File[]) => {
  const zone = screen.getByRole("button", { name: "Import…" }).closest("[data-takes-file-drops]")!;
  const dataTransfer = { files, types: ["Files"] };
  fireEvent.dragOver(zone, { dataTransfer });
  await act(async () => {
    fireEvent.drop(zone, { dataTransfer });
  });
};

afterEach(() => vi.clearAllMocks());

describe("ImportExportSettings", () => {
  it("imports from one button that opens the picker", async () => {
    const { invoke } = renderSection();
    expect(screen.getAllByRole("button", { name: /^Import/ })).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Import…" }));
    });
    expect(invoke).toHaveBeenCalledWith("import.pick", {});
  });

  it("imports a folder or files dropped on the section", async () => {
    const { invoke } = renderSection();
    window.loam.pathForFile = (file: File) => `/home/me/${file.name}`;
    await dropFiles([new File([], "Vault"), new File([], "Notes.enex")]);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("import.pickDropped", {
        paths: ["/home/me/Vault", "/home/me/Notes.enex"],
      }),
    );
  });

  it("says what to drop when nothing dropped is on this computer", async () => {
    const { invoke } = renderSection();
    await dropFiles([new File([], "from-a-page.png")]);
    expect(toasts.toastError).toHaveBeenCalledWith("Nothing to import", expect.anything());
    expect(invoke).not.toHaveBeenCalledWith("import.pickDropped", expect.anything());
  });

  it("exports through one dialog that asks for the open note or all notes", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Export…" }));
    const dialog = screen.getByRole("dialog", { name: "Export as Markdown" });
    expect(within(dialog).getByRole("button", { name: "This note: Plan" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "All notes (1)" })).toBeTruthy();
  });
});

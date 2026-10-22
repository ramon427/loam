// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportMarkdown: vi.fn(),
  revealLastExport: vi.fn(),
  saveAllNoteEdits: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@loam/notes-ui/workspace/saveAllNoteEdits", () => ({
  saveAllNoteEdits: mocks.saveAllNoteEdits,
}));
vi.mock("@loam/notes-ui/ui/toast", () => ({
  toastSuccess: mocks.toastSuccess,
  toastWarning: mocks.toastWarning,
  toastError: mocks.toastError,
}));

import { installFakeBridge } from "@loam/notes-ui/testing/fakeBridge";
import { useMarkdownExport } from "../useMarkdownExport";

installFakeBridge({
  "export.markdown": ({ scope }: { scope: unknown }) => mocks.exportMarkdown(scope),
  "export.reveal": () => mocks.revealLastExport(),
});

const done = (overrides = {}) => ({
  status: "done",
  directory: "/out/Loam export",
  noteCount: 3,
  fileCount: 3,
  missingImages: 0,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.saveAllNoteEdits.mockResolvedValue(true);
});

describe("useMarkdownExport", () => {
  it("saves the open note, waits for saves, exports and offers to show the folder", async () => {
    mocks.exportMarkdown.mockResolvedValue(done());
    const { result } = renderHook(() => useMarkdownExport());

    await act(() => result.current.exportNotes({ kind: "all" }));

    expect(mocks.saveAllNoteEdits.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.exportMarkdown.mock.invocationCallOrder[0]!,
    );
    expect(mocks.exportMarkdown).toHaveBeenCalledWith({ kind: "all" });
    const [message, options] = mocks.toastSuccess.mock.calls[0]!;
    expect(message).toBe("Exported 3 notes");
    options.action.onClick();
    expect(mocks.revealLastExport).toHaveBeenCalled();
    expect(result.current.isExporting).toBe(false);
  });

  it("says nothing when the folder picker is canceled", async () => {
    mocks.exportMarkdown.mockResolvedValue({ status: "canceled" });
    const { result } = renderHook(() => useMarkdownExport());
    await act(() => result.current.exportNotes({ kind: "all" }));
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastWarning).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("warns about unsaved edits and missing images", async () => {
    mocks.saveAllNoteEdits.mockResolvedValue(false);
    mocks.exportMarkdown.mockResolvedValue(done({ noteCount: 1, missingImages: 1 }));
    const { result } = renderHook(() => useMarkdownExport());
    await act(() => result.current.exportNotes({ kind: "note", noteId: "n1" }));
    expect(mocks.toastWarning).toHaveBeenCalledWith("Exported 1 note", {
      description:
        "Your latest unsaved edits are not included. 1 image was not found and left out.",
      action: expect.any(Object),
    });
  });

  it("reports failures and allows another try", async () => {
    mocks.exportMarkdown.mockRejectedValueOnce(new Error("Could not write the export (EACCES)."));
    const { result } = renderHook(() => useMarkdownExport());
    await act(() => result.current.exportNotes({ kind: "all" }));
    expect(mocks.toastError).toHaveBeenCalledWith("Export failed", {
      description: "Could not write the export (EACCES).",
    });
    mocks.exportMarkdown.mockResolvedValue(done());
    await act(() => result.current.exportNotes({ kind: "all" }));
    expect(mocks.toastSuccess).toHaveBeenCalled();
  });

  it("ignores a second request while one is running", async () => {
    let finish!: (value: unknown) => void;
    mocks.exportMarkdown.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useMarkdownExport());
    let first!: Promise<void>;
    act(() => {
      first = result.current.exportNotes({ kind: "all" });
    });
    await act(() => result.current.exportNotes({ kind: "all" }));
    expect(result.current.isExporting).toBe(true);
    await act(async () => {
      finish(done());
      await first;
    });
    expect(mocks.exportMarkdown).toHaveBeenCalledTimes(1);
    expect(result.current.isExporting).toBe(false);
  });
});

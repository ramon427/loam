// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pickImport: vi.fn(),
  pickDroppedImport: vi.fn(),
  saveImportImages: vi.fn(),
  writeImportNotes: vi.fn(),
  finishImport: vi.fn(),
  saveImage: vi.fn(),
  saveAllNoteEdits: vi.fn(),
  convertMarkdownImport: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("../../workspace/saveAllNoteEdits", () => ({
  saveAllNoteEdits: mocks.saveAllNoteEdits,
}));
vi.mock("@loam/transfer/import/markdownImport", () => ({
  convertMarkdownImport: mocks.convertMarkdownImport,
}));
vi.mock("../../ui/toast", () => ({
  toastError: mocks.toastError,
  toastWarning: mocks.toastWarning,
}));

import { installFakeBridge } from "../../testing/fakeBridge";
import { useNotesImport } from "../useNotesImport";

installFakeBridge({
  "import.pick": mocks.pickImport,
  "import.pickDropped": mocks.pickDroppedImport,
  "import.images": mocks.saveImportImages,
  "import.write": mocks.writeImportNotes,
  "import.finish": mocks.finishImport,
  "media.saveImage": mocks.saveImage,
});

const picked = {
  status: "picked",
  source: "markdown",
  sessionId: "session-1",
  name: "Vault",
  files: [{ path: "A.md", text: "a" }],
  skipped: [{ path: "Paper.pdf", reason: "Not a note file" }],
};
const notes = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `note-${index}`, title: `Note ${index}` }));

const renderImport = () => {
  const onImported = vi.fn();
  const view = renderHook(() => useNotesImport({ onImported }));
  return {
    ...view,
    onImported,
    run: () => act(() => view.result.current.importNotes()),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.saveAllNoteEdits.mockResolvedValue(true);
  mocks.pickImport.mockResolvedValue(picked);
  mocks.convertMarkdownImport.mockResolvedValue({
    notes: notes(250),
    skipped: [{ path: "A.md: gone.png", reason: "Image file not found" }],
  });
  mocks.writeImportNotes.mockImplementation(({ notes: batch }: { notes: unknown[] }) =>
    Promise.resolve({ written: batch.length }),
  );
  mocks.finishImport.mockResolvedValue({ noteCount: 250, folderCount: 2 });
});

describe("useNotesImport", () => {
  it("saves open edits, writes in batches, then refreshes the library with a summary", async () => {
    const { run, onImported, result } = renderImport();
    await run();

    expect(mocks.saveAllNoteEdits.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.pickImport.mock.invocationCallOrder[0]!,
    );
    expect(mocks.writeImportNotes.mock.calls.map(([{ notes: batch }]) => batch.length)).toEqual([
      100, 100, 50,
    ]);
    expect(mocks.finishImport).toHaveBeenCalledWith({ sessionId: "session-1" });
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(result.current.progress).toBeNull();
    expect(result.current.summary).toEqual({
      name: "Vault",
      noteCount: 250,
      folderCount: 2,
      skipped: [
        { path: "Paper.pdf", reason: "Not a note file" },
        { path: "A.md: gone.png", reason: "Image file not found" },
      ],
      moreSkipped: 0,
      error: undefined,
    });
    act(() => result.current.dismissSummary());
    expect(result.current.summary).toBeNull();
  });

  it("imports what was dropped through the request that confirms it first", async () => {
    mocks.pickDroppedImport.mockResolvedValue(picked);
    const { result, onImported } = renderImport();
    await act(() => result.current.importNotes(["/Users/me/Vault"]));
    expect(mocks.pickDroppedImport).toHaveBeenCalledWith({ paths: ["/Users/me/Vault"] });
    expect(mocks.pickImport).not.toHaveBeenCalled();
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it("shows conversion progress as the converter reports it", async () => {
    let report: ((done: number, total: number) => void) | undefined;
    let finishConvert!: () => void;
    mocks.convertMarkdownImport.mockImplementation((input: { onProgress: typeof report }) => {
      report = input.onProgress;
      return new Promise((resolve) => {
        finishConvert = () => resolve({ notes: notes(3), skipped: [] });
      });
    });
    const { result, onImported } = renderImport();
    let running!: Promise<void>;
    act(() => {
      running = result.current.importNotes();
    });
    await vi.waitFor(() => expect(report).toBeDefined());
    act(() => report!(25, 250));
    expect(result.current.progress).toEqual({ phase: "converting", done: 25, total: 250 });
    await act(async () => {
      finishConvert();
      await running;
    });
    expect(onImported).toHaveBeenCalled();
  });

  it("copies images through the session that read the files", async () => {
    const { run } = renderImport();
    await run();
    const { saveImages } = mocks.convertMarkdownImport.mock.calls[0]![0];
    await saveImages([{ fromPath: "A.md", reference: "a.png" }]);
    expect(mocks.saveImportImages).toHaveBeenCalledWith({
      sessionId: "session-1",
      requests: [{ fromPath: "A.md", reference: "a.png" }],
    });
  });

  it("saves images carried inside an export through the media store", async () => {
    mocks.saveImage.mockResolvedValue({ path: "a.png", url: "loam-media://images/a.png" });
    const { run } = renderImport();
    await run();
    const { saveImageBytes } = mocks.convertMarkdownImport.mock.calls[0]![0];
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(saveImageBytes(bytes)).resolves.toBe("loam-media://images/a.png");
    expect(mocks.saveImage).toHaveBeenCalledWith({ bytes });
  });

  it("does not start while edits are unsaved", async () => {
    mocks.saveAllNoteEdits.mockResolvedValue(false);
    const { run, onImported, result } = renderImport();
    await run();
    expect(mocks.pickImport).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith("Import not started", expect.any(Object));
    expect(onImported).not.toHaveBeenCalled();
    expect(result.current.progress).toBeNull();
  });

  it("stops quietly when the picker is canceled", async () => {
    mocks.pickImport.mockResolvedValue({ status: "canceled" });
    const { run, onImported, result } = renderImport();
    await run();
    expect(mocks.convertMarkdownImport).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
    expect(result.current.progress).toBeNull();
  });

  it("finishes the import and shows what was saved before a failure", async () => {
    mocks.writeImportNotes
      .mockResolvedValueOnce({ written: 100 })
      .mockRejectedValueOnce(new Error("Disk full."));
    mocks.finishImport.mockResolvedValue({ noteCount: 100, folderCount: 1 });
    const { run, onImported, result } = renderImport();
    await run();
    expect(mocks.finishImport).toHaveBeenCalledWith({ sessionId: "session-1" });
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(result.current.summary).toMatchObject({
      noteCount: 100,
      folderCount: 1,
      error: "Disk full.",
    });
  });

  it("ends the import when converting fails before anything was saved", async () => {
    mocks.convertMarkdownImport.mockRejectedValue(new Error("Unreadable export."));
    mocks.finishImport.mockResolvedValue({ noteCount: 0, folderCount: 0 });
    const { run, onImported } = renderImport();
    await run();
    expect(mocks.finishImport).toHaveBeenCalledWith({ sessionId: "session-1" });
    expect(mocks.toastError).toHaveBeenCalledWith("Import failed", {
      description: "Unreadable export.",
    });
    expect(onImported).not.toHaveBeenCalled();
  });

  it("reports a failure to read what was picked", async () => {
    mocks.pickImport.mockRejectedValue(new Error("That folder is too large to import at once."));
    const { run, onImported, result } = renderImport();
    await run();
    expect(mocks.toastError).toHaveBeenCalledWith("Import failed", {
      description: "That folder is too large to import at once.",
    });
    expect(mocks.finishImport).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
    expect(result.current.progress).toBeNull();
  });

  it("says so when a folder has nothing to import", async () => {
    mocks.convertMarkdownImport.mockResolvedValue({ notes: [], skipped: [] });
    mocks.finishImport.mockResolvedValue({ noteCount: 0, folderCount: 0 });
    const { run, onImported } = renderImport();
    await run();
    expect(mocks.writeImportNotes).not.toHaveBeenCalled();
    expect(mocks.finishImport).toHaveBeenCalled();
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      "Nothing to import from Vault",
      expect.any(Object),
    );
    expect(onImported).not.toHaveBeenCalled();
  });
});

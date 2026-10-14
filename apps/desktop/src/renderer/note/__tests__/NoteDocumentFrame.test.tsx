/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NoteDocumentFrame } from "../NoteDocumentFrame";

const SCROLLING = "data-notes-scrolling";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("NoteDocumentFrame", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("fits below the actual header and releases layout observation on unmount", () => {
    let top = 147;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({ top, width: 900 }) as DOMRect,
    );
    let measure = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          measure = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const { unmount } = render(<NoteDocumentFrame mode="graph">Graph body</NoteDocumentFrame>);
    const canvas = screen.getByTestId("notes-document-canvas");
    expect(canvas.style.getPropertyValue("--notes-graph-top")).toBe("147px");
    top = 180;
    measure();
    expect(canvas.style.getPropertyValue("--notes-graph-top")).toBe("180px");
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("marks the paper canvas while the inset scrolls", () => {
    render(
      <div data-slot="sidebar-inset">
        <NoteDocumentFrame mode="paper">Note body</NoteDocumentFrame>
      </div>,
    );

    const canvas = screen.getByTestId("notes-document-canvas");
    const inset = canvas.closest('[data-slot="sidebar-inset"]');

    expect(canvas.getAttribute("data-notes-document-mode")).toBe("paper");
    expect(canvas.getAttribute(SCROLLING)).toBeNull();

    inset?.dispatchEvent(new Event("scroll"));
    expect(canvas.getAttribute(SCROLLING)).toBe("true");
  });

  it("keeps graph canvases off the document scroll-paint path", () => {
    render(
      <div data-slot="sidebar-inset">
        <NoteDocumentFrame mode="graph" resizable>
          Graph body
        </NoteDocumentFrame>
      </div>,
    );

    const canvas = screen.getByTestId("notes-document-canvas");
    const inset = canvas.closest('[data-slot="sidebar-inset"]');

    expect(canvas.getAttribute("data-notes-document-mode")).toBe("graph");
    expect(canvas.style.getPropertyValue("--notes-document-width")).toBe("");
    expect(screen.queryByRole("separator", { name: "Resize paper width" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resize paper" })).toBeNull();

    inset?.dispatchEvent(new Event("scroll"));
    expect(canvas.getAttribute(SCROLLING)).toBeNull();
  });
});

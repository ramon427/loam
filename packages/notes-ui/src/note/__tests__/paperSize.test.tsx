/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { NoteDocumentFrame } from "../NoteDocumentFrame";

beforeEach(() => localStorage.clear());

const renderPaper = () =>
  render(
    <NoteDocumentFrame mode="paper" resizable>
      <p>Body</p>
    </NoteDocumentFrame>,
  );

const widthHandle = () => screen.getByRole("separator", { name: "Resize paper width" });
const width = () => widthHandle().getAttribute("aria-valuenow");

describe("resizing the paper", () => {
  it("undoes and redoes a resize from the focused handle", () => {
    renderPaper();
    expect(width()).toBe("860");

    fireEvent.keyDown(widthHandle(), { key: "ArrowRight" });
    expect(width()).toBe("870");
    fireEvent.keyDown(widthHandle(), { key: "z", ctrlKey: true });
    expect(width()).toBe("860");
    fireEvent.keyDown(widthHandle(), { key: "z", ctrlKey: true, shiftKey: true });
    expect(width()).toBe("870");
  });

  it("restores the default size from a handle's right-click menu", async () => {
    renderPaper();
    fireEvent.keyDown(widthHandle(), { key: "ArrowRight", shiftKey: true });
    expect(width()).toBe("910");

    fireEvent.contextMenu(widthHandle(), { clientX: 10, clientY: 10 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Restore default size" }));
    await expect.poll(width).toBe("860");

    // The reset is one more step to undo.
    fireEvent.keyDown(widthHandle(), { key: "z", ctrlKey: true });
    expect(width()).toBe("910");
  });
});

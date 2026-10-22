// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Tooltips } from "../Tooltips";

const hover = (element: Element) => {
  fireEvent.pointerOver(element, { pointerType: "mouse" });
  act(() => void vi.advanceTimersByTime(500));
};

describe("tooltips", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows a title in the app's tooltip, not the browser's", () => {
    render(
      <>
        <Tooltips />
        <button type="button" title="Previous match">
          Up
        </button>
      </>,
    );
    const button = screen.getByRole("button", { name: "Up" });
    hover(button);

    expect(screen.getByRole("tooltip").textContent).toBe("Previous match");
    expect(button.getAttribute("title")).toBeNull();
    // The title still describes the button.
    expect(button.getAttribute("aria-description")).toBe("Previous match");
  });

  it("names an icon-only control, and leaves controls with text alone", () => {
    render(
      <>
        <Tooltips />
        <button type="button" aria-label="Zoom in">
          <svg aria-hidden="true" />
        </button>
        <button type="button" aria-label="Save note">
          Save
        </button>
      </>,
    );
    hover(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByRole("tooltip").textContent).toBe("Zoom in");

    hover(screen.getByRole("button", { name: "Save note" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("follows a control's changing text while it shows, and closes on a press", async () => {
    const { rerender } = render(
      <>
        <Tooltips />
        <button type="button" title="Downloading 0.7.0… 10%">
          <svg aria-hidden="true" />
        </button>
      </>,
    );
    const button = screen.getByRole("button");
    hover(button);
    rerender(
      <>
        <Tooltips />
        <button type="button" title="Downloading 0.7.0… 45%">
          <svg aria-hidden="true" />
        </button>
      </>,
    );
    await act(async () => undefined);
    expect(screen.getByRole("tooltip").textContent).toBe("Downloading 0.7.0… 45%");

    fireEvent.pointerDown(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("doesn't repeat a label that shows in full", () => {
    render(
      <>
        <Tooltips />
        <button type="button" title="Notes">
          Notes
        </button>
      </>,
    );
    hover(screen.getByRole("button", { name: "Notes" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("leaves controls that show their own tooltip alone", () => {
    render(
      <>
        <Tooltips />
        <button type="button" aria-label="Bold" data-no-tooltip="">
          <svg aria-hidden="true" />
        </button>
      </>,
    );
    hover(screen.getByRole("button", { name: "Bold" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("leaves a field to its own placeholder", () => {
    render(
      <>
        <Tooltips />
        <input title="Search all notes" placeholder="Search" />
      </>,
    );
    hover(screen.getByPlaceholderText("Search"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SCROLL_IDLE_MS, useMarkWhileScrolling } from "../useMarkWhileScrolling";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function Page({ enabled = true }: { enabled?: boolean }) {
  const ref = useMarkWhileScrolling<HTMLDivElement>(enabled);
  return (
    <div data-testid="scroller">
      <div ref={ref} data-testid="paper" />
    </div>
  );
}

describe("useMarkWhileScrolling", () => {
  it("marks the element while an ancestor scrolls, then clears it once scrolling stops", () => {
    render(<Page />);
    const paper = screen.getByTestId("paper");

    screen.getByTestId("scroller").dispatchEvent(new Event("scroll"));
    expect(paper.getAttribute("data-notes-scrolling")).toBe("true");

    vi.advanceTimersByTime(SCROLL_IDLE_MS - 1);
    expect(paper.getAttribute("data-notes-scrolling")).toBe("true");
    vi.advanceTimersByTime(1);
    expect(paper.hasAttribute("data-notes-scrolling")).toBe(false);
  });

  it("does nothing when disabled", () => {
    render(<Page enabled={false} />);

    screen.getByTestId("scroller").dispatchEvent(new Event("scroll"));
    expect(screen.getByTestId("paper").hasAttribute("data-notes-scrolling")).toBe(false);
  });

  it("stops listening when the element goes away", () => {
    const { unmount } = render(<Page />);
    const scroller = screen.getByTestId("scroller");
    const paper = screen.getByTestId("paper");
    unmount();

    scroller.dispatchEvent(new Event("scroll"));
    expect(paper.hasAttribute("data-notes-scrolling")).toBe(false);
  });
});

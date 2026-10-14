// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmbedTab } from "../EmbedTab";

describe("EmbedTab", () => {
  it("embeds a typed address, and refuses one it can't show", () => {
    const onChange = vi.fn();
    render(<EmbedTab address="" onChange={onChange} />);
    const field = screen.getByRole("textbox", { name: "Web page or image address" });

    fireEvent.change(field, { target: { value: "ftp://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Embed" }));
    expect(screen.getByText(/Enter an https address/)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Embed" }));
    expect(onChange).toHaveBeenCalledWith("https://example.com/");
  });

  it("shows a page in a sandboxed frame, with a way to change it", () => {
    render(<EmbedTab address="https://example.com/" onChange={vi.fn()} />);
    const frame = screen.getByTitle("Embedded page: https://example.com/");
    expect(frame.getAttribute("src")).toBe("https://example.com/");
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-top-navigation");

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(
      (screen.getByRole("textbox", { name: "Web page or image address" }) as HTMLInputElement)
        .value,
    ).toBe("https://example.com/");
  });
});

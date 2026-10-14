// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NoteEditorSwitchLoading } from "../NoteEditorSwitchLoading";

describe("Notes editor loading", () => {
  it("announces what is loading", () => {
    render(<NoteEditorSwitchLoading label="Loading diagram" />);
    expect(screen.getByRole("status", { name: "Loading diagram" })).toBeTruthy();
  });
});

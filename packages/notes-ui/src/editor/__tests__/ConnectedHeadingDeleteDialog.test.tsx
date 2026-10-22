// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  NoteHeadingConnectionOption,
  NoteHeadingConnectionTarget,
} from "../noteHeadingConnections";
import { ConnectedHeadingDeleteDialog } from "../ConnectedHeadingDeleteDialog";

const heading = (id: string, title: string): NoteHeadingConnectionOption => ({
  headingBlockId: id,
  tabId: "text",
  tabTitle: "Notes",
  title,
  level: 2,
  isToggleable: false,
  connectionCount: 1,
});

const target = (
  id: string,
  kind: NoteHeadingConnectionTarget["kind"],
  headingBlockIds: string[],
): NoteHeadingConnectionTarget => ({
  id,
  kind,
  tabId: "graph",
  tabTitle: "Map",
  targetId: id,
  title: `Target ${id}`,
  headingBlockIds,
});

const renderDialog = (impact: Parameters<typeof ConnectedHeadingDeleteDialog>[0]["impact"]) =>
  render(<ConnectedHeadingDeleteDialog impact={impact} onCancel={() => {}} onConfirm={() => {}} />);

describe("ConnectedHeadingDeleteDialog", () => {
  it("says what deleting one connected heading disconnects", () => {
    renderDialog({
      action: "delete",
      headings: [heading("h1", "Setup")],
      targets: [target("n1", "graph-node", ["h1"])],
    });

    const dialog = screen.getByRole("dialog", { name: "Delete connected heading?" });
    expect(dialog.textContent).toContain(
      "This heading is connected to 1 target. Deleting it will remove those connections.",
    );
    expect(dialog.textContent).toContain("Graph node: Target n1 · Map");
    expect(screen.getByRole("button", { name: "Delete heading and disconnect 1" })).toBeTruthy();
  });

  it("speaks of several headings and targets when converting them", () => {
    renderDialog({
      action: "convert",
      headings: [heading("h1", "Setup"), heading("h2", "Exit")],
      targets: [
        target("r1", "table-row", ["h1"]),
        target("c1", "table-column", ["h1", "h2"]),
        target("n1", "graph-node", ["h2"]),
      ],
    });

    const dialog = screen.getByRole("dialog", { name: "Convert connected headings?" });
    expect(dialog.textContent).toContain(
      "These headings are connected to 3 targets. Converting them will remove those connections.",
    );
    expect(screen.getByRole("button", { name: "Convert headings and disconnect 3" })).toBeTruthy();
  });
});

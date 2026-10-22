// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HeadingConnectionManager } from "../HeadingConnectionManager";
import { HeadingTargetManager } from "../HeadingTargetManager";
import type {
  NoteHeadingConnectionOption,
  NoteHeadingConnectionTarget,
} from "../noteHeadingConnections";

const headings: NoteHeadingConnectionOption[] = [
  {
    headingBlockId: "heading-1",
    tabId: "text-1",
    tabTitle: "Plan",
    title: "Entry setup",
    level: 1,
    isToggleable: false,
    connectionCount: 2,
  },
  {
    headingBlockId: "heading-2",
    tabId: "text-1",
    tabTitle: "Plan",
    title: "Review",
    level: 2,
    isToggleable: true,
    connectionCount: 0,
  },
];

const targets: NoteHeadingConnectionTarget[] = [
  {
    id: "graph-node:graph-1:node-1",
    kind: "graph-node",
    tabId: "graph-1",
    tabTitle: "Map",
    targetId: "node-1",
    title: "Breakout",
    headingBlockIds: ["heading-1"],
  },
  {
    id: "table-row:table-1:row-1",
    kind: "table-row",
    tabId: "table-1",
    tabTitle: "Checklist",
    targetId: "row-1",
    title: "Wait for close",
    headingBlockIds: [],
  },
];

describe("HeadingConnectionManager", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        addEventListener: vi.fn(),
        matches: false,
        removeEventListener: vi.fn(),
      })),
    });
  });

  it("toggles multiple headings and exposes destination navigation", () => {
    const onToggleHeading = vi.fn();
    const onOpenHeading = vi.fn();

    render(
      <HeadingConnectionManager
        open
        onOpenChange={vi.fn()}
        targetLabel="Breakout"
        headingOptions={headings}
        selectedHeadingBlockIds={["heading-1"]}
        readOnly={false}
        onToggleHeading={onToggleHeading}
        onOpenHeading={onOpenHeading}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect Review" }));
    expect(onToggleHeading).toHaveBeenCalledWith("heading-2");

    fireEvent.click(screen.getByRole("button", { name: "Open Entry setup" }));
    expect(onOpenHeading).toHaveBeenCalledWith("heading-1");
  });

  it("uses content tabs to switch between graph and table targets", () => {
    const onToggleTarget = vi.fn();

    render(
      <HeadingTargetManager
        onClose={vi.fn()}
        headingBlockId="heading-1"
        headingLabel="Entry setup"
        targets={targets}
        readOnly={false}
        onToggleTarget={onToggleTarget}
        onOpenTarget={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Disconnect Breakout" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Table" }));
    fireEvent.click(screen.getByRole("button", { name: "Connect Wait for close" }));

    expect(onToggleTarget).toHaveBeenCalledWith(targets[1]);
  });
});

// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { blockNoteComponents } from "../blockNoteComponents";

const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } =
  blockNoteComponents.DropdownMenu;

const renderMenuItem = (onClick: () => void) =>
  render(
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
      <DropdownMenuContent>
        {/* Keep the menu open so the same item can be used again. */}
        <DropdownMenuItem onClick={onClick} onSelect={(event) => event.preventDefault()}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );

describe("BlockNote menu items", () => {
  it("run once per press, on pointerdown", () => {
    const onClick = vi.fn();
    renderMenuItem(onClick);
    const item = screen.getByRole("menuitem", { name: "Delete" });

    fireEvent.pointerDown(item, { button: 0 });
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.click(item, { detail: 1 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("still run from the keyboard after a press that never became a click", () => {
    const onClick = vi.fn();
    renderMenuItem(onClick);
    const item = screen.getByRole("menuitem", { name: "Delete" });

    // The pointer went down on the item and was released elsewhere.
    fireEvent.pointerDown(item, { button: 0 });
    // Radix activates an item from Enter with element.click(), whose detail is 0.
    fireEvent.click(item, { detail: 0 });
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});

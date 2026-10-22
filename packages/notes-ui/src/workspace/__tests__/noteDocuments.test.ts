import { describe, expect, it } from "vitest";

import { createNoteDocument } from "../noteDocuments";

describe("createNoteDocument", () => {
  it("makes a note with one empty page tab", () => {
    const note = createNoteDocument("Plan");
    expect(note.title).toBe("Plan");
    expect(note.tabs).toEqual([{ id: note.activeTabId, title: "Notes", kind: "page" }]);
    expect(note.blocksByTab[note.activeTabId]).toBeDefined();
  });
});

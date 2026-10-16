import { describe, expect, it } from "vitest";

import { decideGroup, decideNote, decidePlace, type Arrival } from "../sync/resolve";

const OLDER = "00000000a-0000-aaaaaaaa";
const NEWER = "00000000b-0000-bbbbbbbb";

const newer: Arrival = { order: "concurrent", incomingClock: NEWER, heldClock: OLDER };
const older: Arrival = { order: "concurrent", incomingClock: OLDER, heldClock: NEWER };
const after: Arrival = { order: "apply", incomingClock: OLDER, heldClock: NEWER };

const both = { local: true, incoming: true, same: false };

describe("decideNote", () => {
  it("takes a version that follows the one held, whatever it holds", () => {
    expect(decideNote(after, both)).toEqual({ kept: "incoming", lost: null });
    expect(decideNote(after, { ...both, incoming: false })).toEqual({
      kept: "incoming",
      lost: null,
    });
  });

  it("keeps the newer of two concurrent edits and keeps the other as lost", () => {
    expect(decideNote(newer, both)).toEqual({ kept: "incoming", lost: "local" });
    expect(decideNote(older, both)).toEqual({ kept: "local", lost: "incoming" });
  });

  it("favours the incoming edit when both clocks are equal", () => {
    expect(decideNote({ ...newer, heldClock: NEWER }, both)).toEqual({
      kept: "incoming",
      lost: "local",
    });
  });

  it("lets an edit beat a delete, on either side", () => {
    expect(decideNote(newer, { ...both, incoming: false })).toEqual({ kept: "local", lost: null });
    expect(decideNote(older, { ...both, local: false })).toEqual({ kept: "incoming", lost: null });
  });

  it("merges identical content with nothing lost", () => {
    expect(decideNote(newer, { ...both, same: true })).toEqual({ kept: "local", lost: null });
  });
});

describe("decidePlace", () => {
  it("follows the newest move", () => {
    expect(decidePlace(after)).toBe("incoming");
    expect(decidePlace(newer)).toBe("incoming");
    expect(decidePlace(older)).toBe("local");
  });
});

describe("decideGroup", () => {
  it("follows the newest change", () => {
    expect(decideGroup(after, { local: true, incoming: false })).toBe("incoming");
    expect(decideGroup(newer, { local: true, incoming: true })).toBe("incoming");
    expect(decideGroup(older, { local: true, incoming: true })).toBe("local");
  });

  it("lets a rename or move beat a delete, on either side", () => {
    expect(decideGroup(newer, { local: true, incoming: false })).toBe("local");
    expect(decideGroup(older, { local: false, incoming: true })).toBe("incoming");
  });
});

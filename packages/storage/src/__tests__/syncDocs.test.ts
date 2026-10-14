import { describe, expect, it } from "vitest";

import { conflictCopyId } from "../sync/syncDocs";

describe("conflictCopyId", () => {
  // Every device that sees a conflict makes the copy under this id, so it
  // must never change between versions: devices on different versions would
  // each make their own copy.
  it("gives the same id as every earlier version", () => {
    expect(
      conflictCopyId("00000000-0000-4000-8000-000000000001", "0mfz8x1c0-0000-abcdefgh"),
    ).toMatchInlineSnapshot(`"8bce35bf-d608-88d9-9fb8-0ba58f8b8cdb"`);
    expect(
      conflictCopyId("6f1c2a4e-9b3d-4c7a-8e21-5d0f3b9a7c64", "0mg0aa0zz-00a1-zz9y8x7w"),
    ).toMatchInlineSnapshot(`"96f267a4-1140-814a-920c-652efea9df08"`);
    expect(
      conflictCopyId("6F1C2A4E-9B3D-4C7A-8E21-5D0F3B9A7C64", "0mg0aa0zz-00a1-zz9y8x7w"),
    ).toMatchInlineSnapshot(`"3c60fee4-10c8-804a-98b2-72aefb437b08"`);
  });

  it("is a version 8 UUID", () => {
    expect(
      conflictCopyId("00000000-0000-4000-8000-000000000001", "0mfz8x1c0-0000-abcdefgh"),
    ).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

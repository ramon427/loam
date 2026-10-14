import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createDataKey, type DataKey } from "@loam/storage/encryption/seal";
import { createTempDirectories } from "@loam/storage/testing/tempDirectories";

import { createAttachmentStore } from "../ai/attachments";

const tempDirectory = createTempDirectories("loam-ai-files-");
const THREAD = "11111111-1111-4111-8111-111111111111";

describe("chat files", () => {
  it("are sealed again with a new key, and opened as before", async () => {
    const directory = tempDirectory();
    let key: DataKey | null = null;
    const store = createAttachmentStore({ directory, key: () => key });
    const [notes] = await store.add(THREAD, [
      { name: "notes.txt", bytes: new TextEncoder().encode("Kept private"), text: null },
    ]);
    const onDisk = () => readFile(join(directory, THREAD, notes!.id), "utf8");
    expect(await onDisk()).toBe("Kept private");

    // Encryption turns on: the files are sealed with the new key.
    key = createDataKey();
    await store.reseal(null);
    expect(await onDisk()).not.toContain("Kept private");
    expect((await store.forTurn(THREAD, notes!)).text).toBe("Kept private");

    // The key changes: the old one opens the files to seal them with the new one.
    const previous = key;
    key = createDataKey();
    await store.reseal(previous);
    expect(new TextDecoder().decode(await store.bytes(THREAD, notes!.id))).toBe("Kept private");
  });

  it("take at most four images with a message", () => {
    const store = createAttachmentStore({ directory: tempDirectory(), key: () => null });
    const png = { name: "a.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0]), text: null };
    expect(() => store.check([png, png, png, png])).not.toThrow();
    expect(() => store.check([png, png, png, png, png])).toThrow(/at most 4 images/);
  });
});

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createTempDirectories } from "@loam/storage/testing/tempDirectories";

import { openStorageAdapter } from "../storage";

const tempDirectory = createTempDirectories("loam-storage-");
const dataDirectory = (storageJson?: string) => {
  const directory = tempDirectory();
  if (storageJson !== undefined) writeFileSync(join(directory, "storage.json"), storageJson);
  return directory;
};

describe("storage.json", () => {
  it("opens SQLite without one, or when it names SQLite", async () => {
    for (const directory of [
      dataDirectory(),
      dataDirectory('{ "adapter": "sqlite", "options": {} }'),
    ]) {
      const adapter = openStorageAdapter(directory);
      expect(adapter.name).toBe("sqlite");
      await adapter.close?.();
      expect(existsSync(join(directory, "notes.sqlite"))).toBe(true);
    }
  });

  it("stops with a clear error instead of opening another store", () => {
    for (const [content, message] of [
      ['{ "adapter": 5 }', /storage\.json is not valid \(adapter\)/],
      ["{}", /storage\.json is not valid \(adapter\)/],
      ['{ "adaptor": "my-db" }', /storage\.json is not valid/],
      ['{ "adapter": "sqlite", "options": [] }', /storage\.json is not valid \(options\)/],
      ["[]", /storage\.json is not valid/],
      ["not json", /storage\.json is not valid JSON/],
      ['{ "adapter": "my-db" }', /Unknown storage adapter "my-db"/],
    ] as const) {
      const directory = dataDirectory(content);
      expect(() => openStorageAdapter(directory), content).toThrow(message);
      expect(existsSync(join(directory, "notes.sqlite"))).toBe(false);
    }
  });
});

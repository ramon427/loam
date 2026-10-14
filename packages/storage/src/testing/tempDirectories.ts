import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

/**
 * Returns a function that makes a fresh temp directory, removed after each test.
 * Call it before registering hooks that close stores, so those run first.
 */
export const createTempDirectories = (prefix: string) => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });
  return () => {
    const directory = mkdtempSync(join(tmpdir(), prefix));
    directories.push(directory);
    return directory;
  };
};

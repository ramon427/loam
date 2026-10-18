import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { run } from "../ai/providers/cli";

const folders: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("run", () => {
  it("lets a CLI find programs next to it when the app has the system's bare PATH", async () => {
    const folder = await mkdtemp(join(tmpdir(), "loam-cli-"));
    folders.push(folder);
    const cli = join(folder, "fake-cli");
    await writeFile(cli, '#!/bin/sh\ncat >/dev/null\necho "$PATH"\n');
    await chmod(cli, 0o755);
    // What macOS gives an app opened from the Dock or Finder.
    vi.stubEnv("PATH", "/usr/bin:/bin:/usr/sbin:/sbin");

    const lines: string[] = [];
    await run(cli, [], { cwd: folder, input: "", onLine: (line) => lines.push(line) });

    const path = lines[0]?.split(delimiter) ?? [];
    expect(path.slice(0, 4)).toEqual(["/usr/bin", "/bin", "/usr/sbin", "/sbin"]);
    expect(path).toContain(folder);
    expect(path).toContain("/opt/homebrew/bin");
  });
});

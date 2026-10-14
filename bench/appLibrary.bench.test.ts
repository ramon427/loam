import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";

import { NotesStore } from "@loam/storage/NotesStore";
import { createSqliteStorageAdapter } from "@loam/storage/adapters/sqliteAdapter";

import { placeBenchNotes, seedBenchLibrary } from "./libraryFixture";

/**
 * Writes the benchmark library into a data folder the app can open, for timing
 * the real app: `LOAM_BENCH_DATA_DIR=/tmp/loam-bench npm run bench -- bench/appLibrary`
 * then `LOAM_DATA_DIR=/tmp/loam-bench npm start`.
 */
it.runIf(process.env.LOAM_BENCH_DATA_DIR)(
  "writes a 10,000-note data folder",
  async () => {
    const directory = process.env.LOAM_BENCH_DATA_DIR!;
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(join(directory, "media"), { recursive: true });
    const store = await NotesStore.open({
      adapter: createSqliteStorageAdapter(join(directory, "notes.sqlite")),
    });
    await seedBenchLibrary(store);
    await placeBenchNotes(store);
    await store.close();
  },
  30 * 60 * 1000,
);

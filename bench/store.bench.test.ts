import { mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";

import { NotesStore } from "@loam/storage/NotesStore";
import { newNote } from "@loam/storage/testing/storeFixtures";
import { createSqliteStorageAdapter } from "@loam/storage/adapters/sqliteAdapter";
import { SyncFolder, syncWithFolder } from "@loam/storage/sync/syncFolder";
import { folderStorage } from "@loam/storage/sync/syncStorage";

import { createBackupManager } from "../apps/desktop/src/main/backups/backups";
import { exportNotesAsMarkdown } from "../apps/desktop/src/main/markdownExport";
import {
  BENCH_NOTE_COUNT,
  RARE_WORD,
  benchNoteId,
  createRandom,
  placeBenchNotes,
  seedBenchLibrary,
} from "./libraryFixture";
import { formatMs, report, timeEach, timeOnce, type BenchRow } from "./benchTimer";

const openStore = (file: string) => NotesStore.open({ adapter: createSqliteStorageAdapter(file) });

it(
  "times the notes store with a 10,000-note library",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "loam-bench-"));
    const file = join(directory, "notes.sqlite");
    const rows: BenchRow[] = [];
    try {
      let store = await openStore(file);
      const created = await timeOnce(() => seedBenchLibrary(store));
      rows.push({
        step: `Create ${BENCH_NOTE_COUNT.toLocaleString("en")} notes`,
        result: `${formatMs(created.ms)} (${(created.ms / BENCH_NOTE_COUNT).toFixed(2)} ms per note)`,
      });
      const placed = await timeOnce(() => placeBenchNotes(store));
      rows.push({ step: "Move them into 100 folders", result: formatMs(placed.ms) });
      await store.close();
      rows.push({
        step: "Database size",
        result: `${(statSync(file).size / 1024 ** 2).toFixed(0)} MB`,
      });

      // Cold start: open the file and load the library, as the app does at launch.
      const cold = await timeOnce(async () => {
        store = await openStore(file);
        return store.getLibrary();
      });
      rows.push({ step: "Cold start (open + note list)", result: formatMs(cold.ms) });
      rows.push({
        step: "Note list again",
        result: await timeEach([1, 2, 3, 4, 5], () => store.getLibrary()),
      });

      const random = createRandom(7);
      const someNotes = Array.from({ length: 50 }, () =>
        benchNoteId(random.int(0, BENCH_NOTE_COUNT - 1)),
      );
      rows.push({
        step: "Open a note",
        result: await timeEach(someNotes, (id) => store.getNote(id)),
      });
      rows.push({
        step: "Backlinks of a note",
        result: await timeEach(someNotes, (id) => store.getBacklinks(id)),
      });
      rows.push({
        step: "Search a common word",
        result: await timeEach(["market", "review", "session", "lesson", "pattern"], (query) =>
          store.searchNotes(query, 20),
        ),
      });
      rows.push({
        step: `Search a rare word ("${RARE_WORD}")`,
        result: await timeEach(
          Array.from({ length: 5 }, () => RARE_WORD),
          (query) => store.searchNotes(query, 20),
        ),
      });

      const media = join(directory, "media");
      mkdirSync(media);
      writeFileSync(join(media, "11111111-1111-4111-8111-111111111111.png"), "png");
      const exported = await timeOnce(() =>
        exportNotesAsMarkdown({
          store,
          scope: { kind: "all" },
          parentDirectory: directory,
          mediaDirectory: media,
        }),
      );
      rows.push({ step: "Export all as Markdown", result: formatMs(exported.ms) });
      const backups = createBackupManager({
        store,
        directory: join(directory, "backups"),
        mediaDirectory: media,
        appVersion: "bench",
      });
      // The main process serves the window and its saves; a backup must not stall it.
      let longestStall = 0;
      let lastTick = performance.now();
      const ticker = setInterval(() => {
        const tick = performance.now();
        longestStall = Math.max(longestStall, tick - lastTick - 10);
        lastTick = tick;
      }, 10);
      const saveTimes: number[] = [];
      let backingUp = true;
      const running = timeOnce(() => backups.create("manual")).finally(() => (backingUp = false));
      for (let index = 0; backingUp && index < 40; index += 1) {
        const id = `00000000-0000-4000-9000-${String(index + 1).padStart(12, "0")}`;
        const save = await timeOnce(() =>
          store.createNote(newNote(id, { title: `Written during backup ${index}` })),
        );
        saveTimes.push(save.ms);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const backup = await running;
      clearInterval(ticker);
      rows.push({
        step: "Back up",
        result: `${formatMs(backup.ms)} (${(backup.value.sizeBytes / 1024 ** 2).toFixed(1)} MB file)`,
      });
      rows.push({
        step: "Longest stall during the backup",
        result: `${formatMs(longestStall)} (slowest of ${saveTimes.length} saves: ${formatMs(Math.max(...saveTimes))})`,
      });

      // Sync: this computer publishes the whole library to a sync folder, and a
      // second one with an empty library takes it all in.
      const syncFolder = join(directory, "sync");
      const firstSync = await timeOnce(async () =>
        syncWithFolder(
          store,
          new SyncFolder(folderStorage(syncFolder), await store.readSyncDevice()),
        ),
      );
      rows.push({
        step: "First sync (publish the library)",
        result: `${formatMs(firstSync.ms)} (${firstSync.value.published.toLocaleString("en")} changes)`,
      });
      const second = await openStore(join(directory, "second.sqlite"));
      const joined = await timeOnce(async () =>
        syncWithFolder(
          second,
          new SyncFolder(folderStorage(syncFolder), await second.readSyncDevice()),
        ),
      );
      rows.push({
        step: "Second computer joins (takes it all in)",
        result: `${formatMs(joined.ms)} (${joined.value.changedNoteIds.length.toLocaleString("en")} notes)`,
      });
      const idle = await timeOnce(async () =>
        syncWithFolder(
          second,
          new SyncFolder(folderStorage(syncFolder), await second.readSyncDevice()),
        ),
      );
      rows.push({ step: "Sync with nothing new", result: formatMs(idle.ms) });
      await second.close();
      await store.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    report("Notes store benchmark", rows);
  },
  30 * 60 * 1000,
);

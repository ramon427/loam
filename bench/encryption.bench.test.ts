import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";

import { NotesStore } from "@loam/storage/NotesStore";
import { createSqliteStorageAdapter } from "@loam/storage/adapters/sqliteAdapter";
import { convertStoredRecords, withEncryption } from "@loam/storage/encryption/encryptedAdapter";
import {
  createRecoveryKey,
  lockDataKey,
  unlockWithPassphrase,
} from "@loam/storage/encryption/keyLocks";
import { createDataKey } from "@loam/storage/encryption/seal";

import { formatMs, report, timeEach, timeOnce, type BenchRow } from "./benchTimer";
import {
  BENCH_NOTE_COUNT,
  RARE_WORD,
  benchNoteId,
  createRandom,
  placeBenchNotes,
  seedBenchLibrary,
} from "./libraryFixture";

it(
  "times an encrypted 10,000-note library",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "loam-encryption-bench-"));
    const file = join(directory, "notes.sqlite");
    const rows: BenchRow[] = [];
    try {
      const inner = createSqliteStorageAdapter(file);
      let store = await NotesStore.open({ adapter: inner });
      await seedBenchLibrary(store);
      await placeBenchNotes(store);
      const key = createDataKey();
      const locks = await lockDataKey(key, {
        passphrase: "bench passphrase",
        recoveryKey: createRecoveryKey(),
      });

      const encrypted = await timeOnce(() =>
        store.replaceAdapter(async () => {
          await convertStoredRecords(inner, { from: null, to: key });
          return withEncryption(inner, key);
        }),
      );
      rows.push({
        step: `Turn encryption on (${BENCH_NOTE_COUNT.toLocaleString("en")} notes)`,
        result: formatMs(encrypted.ms),
      });
      rows.push({
        step: "Encrypted database size",
        result: `${(statSync(file).size / 1024 ** 2).toFixed(0)} MB`,
      });
      await store.close();

      const unlocked = await timeOnce(() => unlockWithPassphrase(locks, "bench passphrase"));
      rows.push({ step: "Unlock (scrypt)", result: formatMs(unlocked.ms) });
      const cold = await timeOnce(async () => {
        store = await NotesStore.open({
          adapter: withEncryption(createSqliteStorageAdapter(file), unlocked.value!),
        });
        return store.getLibrary();
      });
      rows.push({ step: "Cold start, encrypted", result: formatMs(cold.ms) });

      const random = createRandom(7);
      const someNotes = Array.from({ length: 50 }, () =>
        benchNoteId(random.int(0, BENCH_NOTE_COUNT - 1)),
      );
      rows.push({
        step: "Open a note, encrypted",
        result: await timeEach(someNotes, (id) => store.getNote(id)),
      });
      // The first search folds every note's text; later ones reuse it.
      const firstSearch = await timeOnce(() => store.searchNotes("market", 20));
      rows.push({ step: "First search after unlocking", result: formatMs(firstSearch.ms) });
      rows.push({
        step: "Search a common word, encrypted",
        result: await timeEach(["market", "review", "session", "lesson", "pattern"], (query) =>
          store.searchNotes(query, 20),
        ),
      });
      rows.push({
        step: `Search a rare word, encrypted`,
        result: await timeEach(
          Array.from({ length: 5 }, () => RARE_WORD),
          (query) => store.searchNotes(query, 20),
        ),
      });
      await store.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    report("Encryption benchmark", rows);
  },
  30 * 60 * 1000,
);

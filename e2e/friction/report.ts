import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { format } from "prettier";

import type { FlowResult } from "./meter.ts";

/**
 * Prints the friction table from the last run, next to the committed baseline.
 * `node e2e/friction/report.ts` compares; `--save` makes the last run the new baseline.
 */

const BASELINE = join(import.meta.dirname, "baseline.json");
/** Where the meter writes each flow (meter.ts). */
const RESULTS_DIRECTORY = join(import.meta.dirname, "..", "..", "tmp", "friction");

type Row = Omit<FlowResult, "log" | "thinking">;

const weekly = (row: Row) => Math.round(row.perWeek * row.overheadSeconds * 10) / 10;

const read = (): Row[] =>
  readdirSync(RESULTS_DIRECTORY)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const {
        log: _log,
        thinking: _thinking,
        ...row
      } = JSON.parse(readFileSync(join(RESULTS_DIRECTORY, file), "utf8")) as FlowResult;
      return row;
    })
    .sort((a, b) => a.job.localeCompare(b.job) || a.flow.localeCompare(b.flow));

const change = (now: number, before: number | undefined) =>
  before === undefined || before === now
    ? ""
    : ` (${now > before ? "+" : ""}${Math.round((now - before) * 10) / 10})`;

const rows = read();
const baseline: Row[] = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : [];
const before = new Map(baseline.map((row) => [`${row.job}/${row.flow}`, row]));

const lines = [
  "| Job | Flow | Keys | Typed | Clicks | Decisions | Mouse-only | Waits ms | Overhead s | Per week | s/week |",
  "|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|",
  ...rows.map((row) => {
    const old = before.get(`${row.job}/${row.flow}`);
    return `| ${row.job} | ${row.flow} | ${row.keystrokes}${change(row.keystrokes, old?.keystrokes)} | ${row.typed} | ${row.clicks}${change(row.clicks, old?.clicks)} | ${row.decisions}${change(row.decisions, old?.decisions)} | ${row.mouseOnly.length}${change(row.mouseOnly.length, old?.mouseOnly.length)} | ${row.waitMs} | ${row.overheadSeconds}${change(row.overheadSeconds, old?.overheadSeconds)} | ${row.perWeek} | ${weekly(row)} |`;
  }),
];
const total = (list: Row[]) => Math.round(list.reduce((sum, row) => sum + weekly(row), 0));
lines.push(
  "",
  `Friction per week: ${total(rows)} s${baseline.length ? ` (baseline ${total(baseline)} s)` : ""}`,
);

const report = lines.join("\n");
writeFileSync(join(RESULTS_DIRECTORY, "report.md"), `${report}\n`);
console.log(report);

if (process.argv.includes("--save")) {
  writeFileSync(BASELINE, await format(JSON.stringify(rows), { parser: "json" }));
  console.log(`\nSaved ${rows.length} flows as the baseline.`);
}

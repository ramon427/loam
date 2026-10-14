import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { join } from "node:path";

export type BenchRow = { step: string; result: string };

const round = (ms: number) => (ms >= 100 ? Math.round(ms) : Math.round(ms * 10) / 10);

/** Times one run of `run`. */
export const timeOnce = async <T>(run: () => Promise<T>) => {
  const start = performance.now();
  const value = await run();
  return { ms: performance.now() - start, value };
};

/** Runs `run` once per input and reports the median and 95th percentile. */
export const timeEach = async <T>(inputs: readonly T[], run: (input: T) => Promise<unknown>) => {
  const times: number[] = [];
  for (const input of inputs) times.push((await timeOnce(() => run(input))).ms);
  times.sort((left, right) => left - right);
  const at = (fraction: number) =>
    times[Math.min(times.length - 1, Math.floor(times.length * fraction))]!;
  return `median ${round(at(0.5))} ms, p95 ${round(at(0.95))} ms (${times.length} runs)`;
};

export const formatMs = (ms: number) =>
  ms >= 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${round(ms)} ms`;

const machine = () =>
  `${cpus()[0]?.model.trim() ?? "unknown CPU"}, ${cpus().length} cores, ${Math.round(totalmem() / 1024 ** 3)} GB RAM, Node ${process.versions.node}`;

/** Prints the results and saves them under tmp/bench so runs can be compared. */
export const report = (name: string, rows: BenchRow[]) => {
  const lines = [
    `\n${name} — ${machine()}`,
    ...rows.map((row) => `  ${row.step.padEnd(34)} ${row.result}`),
  ];
  process.stderr.write(`${lines.join("\n")}\n`);
  const directory = join(process.cwd(), "tmp", "bench");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${name.replace(/\W+/g, "-").toLowerCase()}.json`),
    JSON.stringify({ name, machine: machine(), at: new Date().toISOString(), rows }, null, 2),
  );
};

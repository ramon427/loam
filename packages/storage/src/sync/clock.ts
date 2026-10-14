/**
 * Clocks that order changes across devices.
 *
 * A clock is `<ms>-<counter>-<device>` with fixed-width base-36 numbers, so
 * comparing two clocks as strings orders them in time (a hybrid logical clock:
 * wall time, plus a counter for changes within one millisecond or while the
 * wall clock lags behind a clock already seen). Device ids break ties.
 *
 * A version vector records, per device, the newest change of that device a
 * document's version includes. Comparing two vectors tells whether one version
 * already contains the other or whether they were edited concurrently.
 */

export type Clock = string;
export type VersionVector = Record<string, Clock>;

const MS_WIDTH = 9;
const COUNTER_WIDTH = 4;
const MAX_COUNTER = 36 ** COUNTER_WIDTH - 1;
export const DEVICE_ID_PATTERN = /^[0-9a-z]{8}$/;
export const CLOCK_PATTERN = /^([0-9a-z]{9})-([0-9a-z]{4})-([0-9a-z]{8})$/;

export const isClock = (value: unknown): value is Clock =>
  typeof value === "string" && CLOCK_PATTERN.test(value);

const clockDevice = (clock: Clock) => clock.slice(-8);

const formatClock = (ms: number, counter: number, device: string) =>
  `${ms.toString(36).padStart(MS_WIDTH, "0")}-${counter
    .toString(36)
    .padStart(COUNTER_WIDTH, "0")}-${device}`;

const parseClock = (clock: Clock) => {
  const match = CLOCK_PATTERN.exec(clock);
  if (!match) throw new Error(`Invalid clock: ${clock}`);
  return { ms: Number.parseInt(match[1]!, 36), counter: Number.parseInt(match[2]!, 36) };
};

/** A random device id: eight base-36 characters. */
export const createDeviceId = (random: () => number = Math.random) =>
  Array.from({ length: 8 }, () => Math.floor(random() * 36).toString(36)).join("");

/** Issues this device's clocks; each is later than every clock it issued or observed. */
export class DeviceClock {
  private last: { ms: number; counter: number };

  constructor(
    readonly device: string,
    last: Clock | null,
    private readonly now: () => number,
  ) {
    if (!DEVICE_ID_PATTERN.test(device)) throw new Error(`Invalid device id: ${device}`);
    this.last = last ? parseClock(last) : { ms: 0, counter: 0 };
  }

  next(): Clock {
    const now = this.now();
    if (now > this.last.ms) this.last = { ms: now, counter: 0 };
    else if (this.last.counter < MAX_COUNTER)
      this.last = { ms: this.last.ms, counter: this.last.counter + 1 };
    else this.last = { ms: this.last.ms + 1, counter: 0 };
    return formatClock(this.last.ms, this.last.counter, this.device);
  }

  /** Keeps later clocks after one seen from another device. */
  observe(clock: Clock) {
    const seen = parseClock(clock);
    if (seen.ms > this.last.ms || (seen.ms === this.last.ms && seen.counter > this.last.counter))
      this.last = seen;
  }

  /** The newest clock issued or observed, for persisting. */
  current(): Clock {
    return formatClock(this.last.ms, this.last.counter, this.device);
  }
}

export type VectorOrder = "equal" | "before" | "after" | "concurrent";

/** How version `a` relates to version `b`: "after" means `a` contains `b`. */
export const compareVectors = (a: VersionVector, b: VersionVector): VectorOrder => {
  let aAhead = false;
  let bAhead = false;
  for (const device of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const left = a[device] ?? "";
    const right = b[device] ?? "";
    if (left > right) aAhead = true;
    else if (right > left) bAhead = true;
  }
  if (aAhead && bAhead) return "concurrent";
  if (aAhead) return "after";
  if (bAhead) return "before";
  return "equal";
};

export const mergeVectors = (a: VersionVector, b: VersionVector): VersionVector => {
  const merged: VersionVector = { ...a };
  for (const [device, clock] of Object.entries(b))
    if (!merged[device] || clock > merged[device]) merged[device] = clock;
  return merged;
};

export const isVersionVector = (value: unknown): value is VersionVector =>
  Boolean(value) &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.entries(value as Record<string, unknown>).every(
    ([device, clock]) =>
      DEVICE_ID_PATTERN.test(device) && isClock(clock) && clockDevice(clock) === device,
  );

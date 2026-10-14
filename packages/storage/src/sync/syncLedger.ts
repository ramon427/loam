import type { StorageAdapter, StorageWrite } from "../adapter";
import {
  compareVectors,
  createDeviceId,
  DeviceClock,
  mergeVectors,
  type Clock,
  type VectorOrder,
  type VersionVector,
} from "./clock";
import type { PlaceValue, SyncChange, SyncChangeRef, SyncDocKey } from "./syncDocs";

/**
 * Where each document stands for sync: the versions it includes, the clock of
 * the version held, and whether that version still has to be published.
 * Written in the same commit as the change it describes, so a change is never
 * saved without being queued for sync, even if the app quits right after.
 */
export type SyncRecord = {
  vector: VersionVector;
  clock: Clock;
  /** Changed here and not yet published. */
  dirty?: true;
  /** A place that arrived before its note; used when the note does. */
  pendingPlace?: PlaceValue;
};

type SyncState = {
  device: string;
  /** The newest clock issued or seen, so clocks keep increasing across restarts. */
  clock: Clock | null;
  /** The sync library everything was last published to. */
  libraryId: string | null;
  /** Set by a restore: publish every document again on the next sync. */
  republish?: true;
};

const STATE_ID = "~state";

/**
 * How an incoming version relates to the one held: already held ("skip"),
 * newer ("apply"), or edited concurrently ("concurrent").
 */
export type IncomingOrder = "skip" | "apply" | "concurrent";

const toIncomingOrder = (order: VectorOrder): IncomingOrder =>
  order === "after" ? "apply" : order === "concurrent" ? "concurrent" : "skip";

/**
 * The per-document sync records of one store. The store calls it inside its
 * serialized calls and commits. A save reads only the records it touches
 * (`read`); syncing reads them all once (`loadAll`). The other methods answer
 * from what is loaded and throw for a record that isn't, rather than take it
 * for missing.
 */
export class SyncLedger {
  /** Records read so far; null where a document has none. */
  private readonly records = new Map<SyncDocKey, SyncRecord | null>();
  private complete = false;

  private constructor(
    private adapter: StorageAdapter,
    private state: SyncState,
    private readonly clock: DeviceClock,
  ) {}

  static async load(adapter: StorageAdapter, now: () => number) {
    // Only the ledger writes the sync collection; the clock checks the device id it holds.
    const stored = (await adapter.get("sync", STATE_ID))?.value as SyncState | undefined;
    const state = stored ?? { device: createDeviceId(), clock: null, libraryId: null };
    return new SyncLedger(adapter, state, new DeviceClock(state.device, state.clock, now));
  }

  /** Reads from `adapter` from now on; it holds the same records. */
  useAdapter(adapter: StorageAdapter) {
    this.adapter = adapter;
  }

  /** Reads every record, for syncing. */
  async loadAll() {
    if (this.complete) return;
    for (const record of await this.adapter.list("sync"))
      if (record.id !== STATE_ID)
        this.records.set(record.id as SyncDocKey, record.value as SyncRecord);
    this.complete = true;
  }

  /** A document's record, read if it isn't loaded yet; undefined when it has none. */
  async read(key: SyncDocKey) {
    if (!this.complete && !this.records.has(key))
      this.records.set(key, ((await this.adapter.get("sync", key))?.value as SyncRecord) ?? null);
    return this.records.get(key) ?? undefined;
  }

  private loaded(key: SyncDocKey) {
    if (!this.complete && !this.records.has(key))
      throw new Error(`The sync record of ${key} isn't loaded.`);
    return this.records.get(key) ?? undefined;
  }

  private requireAll() {
    if (!this.complete) throw new Error("Sync records aren't loaded.");
  }

  get device() {
    return this.state.device;
  }

  get libraryId() {
    return this.state.libraryId;
  }

  get needsRepublish() {
    return Boolean(this.state.republish);
  }

  /** Every document with a record. */
  keys() {
    this.requireAll();
    return [...this.records].flatMap(([key, record]) => (record ? [key] : []));
  }

  /** Writes recording that `keys` changed here; returns them with the state record. */
  async recordLocal(keys: Iterable<SyncDocKey>): Promise<StorageWrite[]> {
    const writes: StorageWrite[] = [];
    for (const key of new Set(keys)) {
      const previous = await this.read(key);
      const clock = this.clock.next();
      writes.push(
        this.put(key, {
          vector: { ...previous?.vector, [this.device]: clock },
          clock,
          dirty: true,
        }),
      );
    }
    if (writes.length > 0) writes.push(this.putState({}));
    return writes;
  }

  /** How an incoming change relates to the version held here. */
  order(change: SyncChange): IncomingOrder {
    const held = this.loaded(change.key);
    return held ? toIncomingOrder(compareVectors(change.vector, held.vector)) : "apply";
  }

  /** True when the version a file names is already part of what is held here. */
  holds({ key, clock }: SyncChangeRef) {
    const held = this.loaded(key)?.vector[clock.slice(-8)];
    return held !== undefined && held >= clock;
  }

  /** The clock of the version held here, for "newest edit wins". */
  heldClock(key: SyncDocKey) {
    return this.loaded(key)?.clock ?? "";
  }

  /**
   * Records the outcome of an incoming change: the versions both sides had
   * are now included. `kept` says whose content stays: the incoming change's
   * (then nothing is left to publish) or the local one (still published if dirty).
   */
  recordIncoming(
    change: SyncChange,
    kept: "incoming" | "local",
    pendingPlace?: PlaceValue,
  ): StorageWrite[] {
    this.clock.observe(change.clock);
    const held = this.loaded(change.key);
    const record: SyncRecord = {
      vector: mergeVectors(held?.vector ?? {}, change.vector),
      clock: kept === "incoming" || !held ? change.clock : held.clock,
    };
    if (kept === "local" && held?.dirty) record.dirty = true;
    if (pendingPlace) record.pendingPlace = pendingPlace;
    return [this.put(change.key, record), this.putState({})];
  }

  /** Takes the place that waited for a note to arrive; returns the write that forgets it. */
  takePendingPlace(key: SyncDocKey): { place: PlaceValue; write: StorageWrite } | null {
    const record = this.loaded(key);
    if (!record?.pendingPlace) return null;
    const { pendingPlace: place, ...rest } = record;
    return { place, write: this.put(key, rest) };
  }

  /** Every document changed here and not yet published, with the clock it was changed at. */
  unpublished(): Array<{ key: SyncDocKey; record: SyncRecord }> {
    this.requireAll();
    return [...this.records].flatMap(([key, record]) => (record?.dirty ? [{ key, record }] : []));
  }

  /** Clears the dirty flag of versions that were published and haven't changed since. */
  markPublished(published: readonly SyncChangeRef[]): StorageWrite[] {
    const writes: StorageWrite[] = [];
    for (const { key, clock } of published) {
      const record = this.loaded(key);
      if (!record?.dirty || record.clock !== clock) continue;
      const { dirty: _dirty, ...rest } = record;
      writes.push(this.put(key, rest));
    }
    return writes;
  }

  /** Marks `keys` changed here so they are published again, and remembers the library. */
  async republish(keys: Iterable<SyncDocKey>, libraryId: string): Promise<StorageWrite[]> {
    // The state write comes last, so it is the one kept.
    return [...(await this.recordLocal(keys)), this.putState({ libraryId, republish: undefined })];
  }

  /** Asks for everything to be published again on the next sync (after a restore). */
  requestRepublish(): StorageWrite {
    return this.putState({ republish: true });
  }

  /** Updates the cache once a commit holding sync writes succeeded. */
  afterCommit(writes: readonly StorageWrite[]) {
    for (const write of writes) {
      if (write.collection !== "sync") continue;
      if (write.id === STATE_ID) {
        if (write.type === "put") this.state = write.value as SyncState;
      } else if (write.type === "delete") this.records.set(write.id as SyncDocKey, null);
      else this.records.set(write.id as SyncDocKey, write.value as SyncRecord);
    }
  }

  private put(key: SyncDocKey, record: SyncRecord): StorageWrite {
    return { type: "put", collection: "sync", id: key, value: record };
  }

  private putState(update: Partial<SyncState>): StorageWrite {
    return {
      type: "put",
      collection: "sync",
      id: STATE_ID,
      // JSON drops a field the update sets to undefined.
      value: { ...this.state, ...update, clock: this.clock.current() } satisfies SyncState,
    };
  }
}

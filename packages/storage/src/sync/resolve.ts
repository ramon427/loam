import type { Clock } from "./clock";
import type { IncomingOrder } from "./syncLedger";

/**
 * Which version of a document stays when a change arrives from another
 * device. Pure, so every rule can be tested without a store; the store
 * applies the outcome.
 */

export type Side = "incoming" | "local";

/** How the incoming version relates to the one held, and both versions' clocks. */
export type Arrival = {
  order: Exclude<IncomingOrder, "skip">;
  incomingClock: Clock;
  /** The clock of the version held here; "" when none is. */
  heldClock: Clock;
};

/** Of two concurrent versions, the newer one wins; equal clocks favour the incoming one. */
const newer = ({ incomingClock, heldClock }: Arrival): Side =>
  incomingClock < heldClock ? "local" : "incoming";

/**
 * A note: the newest edit wins and the other is kept in the note's history
 * (`lost` names whose content that is). An edit always beats a delete, and
 * identical content just merges.
 */
export const decideNote = (
  arrival: Arrival,
  { local, incoming, same }: { local: boolean; incoming: boolean; same: boolean },
): { kept: Side; lost: Side | null } => {
  if (arrival.order !== "concurrent") return { kept: "incoming", lost: null };
  if (same || !incoming) return { kept: "local", lost: null };
  if (!local) return { kept: "incoming", lost: null };
  const kept = newer(arrival);
  return { kept, lost: kept === "local" ? "incoming" : "local" };
};

/** A note's place follows the newest move. */
export const decidePlace = (arrival: Arrival): Side =>
  arrival.order === "concurrent" ? newer(arrival) : "incoming";

/** A folder or project follows the newest change; renaming or moving one beats deleting it. */
export const decideGroup = (
  arrival: Arrival,
  { local, incoming }: { local: boolean; incoming: boolean },
): Side => {
  if (arrival.order !== "concurrent" || (!local && !incoming)) return "incoming";
  if (!incoming) return "local";
  return local ? newer(arrival) : "incoming";
};

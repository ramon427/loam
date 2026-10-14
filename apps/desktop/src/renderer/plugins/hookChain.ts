/*
 * How a plugin event runs: every hook whose matcher fits, in plugin order and then the order
 * each plugin added them, each given `next` to run the rest and then the app's own behaviour.
 * A hook that fails or runs out of time is skipped, so one plugin can't stop an event for all.
 */

export type HookRegistration = {
  pluginId: string;
  hookId: string;
  event: string;
  matcher: unknown;
};

/** Whether `e` holds every value `matcher` names, at any depth. Arrays must match whole. */
export const matches = (matcher: unknown, e: unknown): boolean => {
  if (matcher === undefined || matcher === null) return true;
  if (typeof matcher !== "object" || Array.isArray(matcher))
    return JSON.stringify(matcher) === JSON.stringify(e);
  if (typeof e !== "object" || e === null) return false;
  return Object.entries(matcher).every(([key, value]) =>
    matches(value, (e as Record<string, unknown>)[key]),
  );
};

export type InvokeHook = (
  registration: HookRegistration,
  e: unknown,
  next: (e: unknown) => Promise<unknown>,
) => Promise<unknown>;

export const runChain = (
  registrations: readonly HookRegistration[],
  e: unknown,
  invoke: InvokeHook,
  base: (e: unknown) => unknown,
  onFailure: (registration: HookRegistration, error: unknown) => void,
): Promise<unknown> => {
  const step = async (index: number, current: unknown): Promise<unknown> => {
    const registration = registrations[index];
    if (!registration) return base(current);
    let nextRun: Promise<unknown> | null = null;
    const next = (changed: unknown) => {
      // A hook that calls next twice gets the first run's result again.
      nextRun ??= step(index + 1, changed);
      return nextRun;
    };
    try {
      return await invoke(registration, current, next);
    } catch (error) {
      onFailure(registration, error);
      // What the rest of the chain made of it, if the hook got that far; else the rest, unchanged.
      return nextRun ?? step(index + 1, current);
    }
  };
  return step(0, e);
};

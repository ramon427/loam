import { useState, useSyncExternalStore } from "react";

/**
 * A value that event handlers can read back synchronously right after setting it. React
 * state alone cannot do that: a handler that sets state and then reads it still sees the
 * render-time value, so two edits in one handler would overwrite each other.
 */
type ValueStore<T> = {
  get: () => T;
  set: (next: T) => void;
  subscribe: (listener: () => void) => () => void;
};

function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Renders from a {@link ValueStore}; the store is created once from `initial`. */
export function useValueStore<T>(initial: () => T) {
  const [store] = useState(() => createValueStore(initial()));
  const value = useSyncExternalStore(store.subscribe, store.get, store.get);
  return [value, store] as const;
}

import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { stableJsonStringify } from "@loam/shared/utils/stableJson";

/** Undo and redo for the tab in view, as the note's toolbar calls them. */
export type TabHistoryCommands = { undo(): void; redo(): void };

type UseTypedTabHistoryOptions<T> = {
  identity: string;
  value: T;
  onCommit: (value: T) => void;
  bridgeRef?: MutableRefObject<TabHistoryCommands | null>;
  limit?: number;
  isLocalEcho?: (localValue: T, incomingValue: T) => boolean;
};

export const areTypedTabValuesEqual = <T>(left: T, right: T) =>
  stableJsonStringify(left) === stableJsonStringify(right);

/**
 * A field edit burst that publishes faster than this window shares one past
 * snapshot, so typing a title, note, or label undoes in a single step.
 */
export const typedTabHistoryGroupWindowMs = 500;

type TypedTabHistoryGroupState = {
  at: number;
  key: string;
};

const areEqual = areTypedTabValuesEqual;

export function useTypedTabHistory<T>({
  identity,
  value,
  onCommit,
  bridgeRef,
  limit = 100,
  isLocalEcho = areEqual,
}: UseTypedTabHistoryOptions<T>) {
  const identityRef = useRef(identity);
  const currentRef = useRef(value);
  const pastRef = useRef<T[]>([]);
  const futureRef = useRef<T[]>([]);
  const localValuesRef = useRef<T[]>([]);
  const groupRef = useRef<TypedTabHistoryGroupState | null>(null);

  const publish = useCallback(
    (nextValue: T) => {
      // Parent props can echo earlier local commits after a later Undo/Redo.
      // Keep those echoes from being mistaken for an external replacement.
      localValuesRef.current = [...localValuesRef.current, nextValue].slice(-limit);
      onCommit(nextValue);
    },
    [limit, onCommit],
  );

  useEffect(() => {
    if (identityRef.current !== identity) {
      identityRef.current = identity;
      currentRef.current = value;
      pastRef.current = [];
      futureRef.current = [];
      localValuesRef.current = [];
      groupRef.current = null;
      return;
    }
    if (!areEqual(currentRef.current, value)) {
      const localEcho = localValuesRef.current.some((localValue) => isLocalEcho(localValue, value));
      if (localEcho) return;
      currentRef.current = value;
      pastRef.current = [];
      futureRef.current = [];
      localValuesRef.current = [];
      groupRef.current = null;
    }
  }, [identity, isLocalEcho, value]);

  const commit = useCallback(
    (nextValue: T, group?: string) => {
      if (areEqual(currentRef.current, nextValue)) return false;
      const now = Date.now();
      const activeGroup = groupRef.current;
      // Published values always move forward. Only the past snapshot is shared,
      // and only while the same field keeps publishing inside the window.
      const continuesGroup =
        Boolean(group) &&
        activeGroup !== null &&
        activeGroup.key === group &&
        now - activeGroup.at <= typedTabHistoryGroupWindowMs;
      if (!continuesGroup) {
        pastRef.current = [...pastRef.current, currentRef.current].slice(-limit);
      }
      currentRef.current = nextValue;
      futureRef.current = [];
      groupRef.current = group ? { at: now, key: group } : null;
      publish(nextValue);
      return true;
    },
    [limit, publish],
  );

  const undo = useCallback(() => {
    const previous = pastRef.current.at(-1);
    if (!previous) return false;
    groupRef.current = null;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [currentRef.current, ...futureRef.current].slice(0, limit);
    currentRef.current = previous;
    publish(previous);
    return true;
  }, [limit, publish]);

  const redo = useCallback(() => {
    const next = futureRef.current[0];
    if (!next) return false;
    groupRef.current = null;
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current, currentRef.current].slice(-limit);
    currentRef.current = next;
    publish(next);
    return true;
  }, [limit, publish]);

  const canUndo = useCallback(() => pastRef.current.length > 0, []);
  const canRedo = useCallback(() => futureRef.current.length > 0, []);

  useEffect(() => {
    if (!bridgeRef) return;
    bridgeRef.current = { undo, redo };
    return () => {
      if (bridgeRef.current?.undo === undo) bridgeRef.current = null;
    };
  }, [bridgeRef, redo, undo]);

  return useMemo(
    () => ({ commit, undo, redo, canUndo, canRedo }),
    [canRedo, canUndo, commit, redo, undo],
  );
}

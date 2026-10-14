import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { callBridge } from "../bridge";
import { errorMessage } from "../lib/errorMessage";
import { toastError } from "../ui/toast";

import {
  EMPTY_LIBRARY,
  LIBRARY_KEY,
  readLibrary,
  toLayout,
  toLibrary,
  type Library,
} from "./notesLibrary";

/**
 * Changes to the cached library and the layout saved from it: where notes,
 * folders and projects are, and in what order.
 */
export function useLibraryLayout() {
  const queryClient = useQueryClient();

  const setLibrary = useCallback(
    (update: (current: Library) => Library) =>
      queryClient.setQueryData<Library>(LIBRARY_KEY, (current) => update(current ?? EMPTY_LIBRARY)),
    [queryClient],
  );

  /** Reads the library again after a change failed, so the sidebar shows what is stored. */
  const recover = useCallback(
    (message: string, error: unknown) => {
      void queryClient.invalidateQueries({ queryKey: LIBRARY_KEY });
      toastError(message, {
        description: errorMessage(error),
      });
    },
    [queryClient],
  );

  const saveLayout = useCallback(
    async (next: Library, failure: string) => {
      setLibrary(() => next);
      try {
        const saved = await callBridge("notes.saveLayout", { layout: toLayout(next) });
        setLibrary(() => toLibrary(saved));
      } catch (error) {
        recover(failure, error);
      }
    },
    [recover, setLibrary],
  );

  const rearrange = useCallback(
    (change: Partial<Library>, failure: string) =>
      saveLayout({ ...readLibrary(queryClient), ...change }, failure),
    [queryClient, saveLayout],
  );

  return { setLibrary, recover, saveLayout, rearrange };
}

export type LibraryLayout = ReturnType<typeof useLibraryLayout>;

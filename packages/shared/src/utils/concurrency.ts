/**
 * Runs `run` on every item, at most `limit` at a time, so slow work such as
 * network requests overlaps without starting thousands at once. Rejects with
 * the first failure, after the items already started have settled.
 */
export const forEachConcurrently = async <T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
) => {
  let next = 0;
  let failure: { error: unknown } | null = null;
  const worker = async () => {
    while (!failure && next < items.length) {
      const item = items[next++]!;
      try {
        await run(item);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure) throw (failure as { error: unknown }).error;
};

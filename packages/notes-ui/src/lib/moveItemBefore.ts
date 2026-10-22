export type SortableInsertHalf = "before" | "after";

const resolveSortableInsertBeforeId = <TId extends string>(
  ids: readonly TId[],
  targetId: TId,
  half: SortableInsertHalf,
): TId | null => {
  if (half === "before") return targetId;
  const targetIndex = ids.indexOf(targetId);
  if (targetIndex === -1) return targetId;
  return ids[targetIndex + 1] ?? null;
};

const isNoOpSortableMove = <TId extends string>(
  ids: readonly TId[],
  sourceId: TId,
  beforeId: TId | null,
): boolean => {
  const sourceIndex = ids.indexOf(sourceId);
  if (sourceIndex === -1) return true;
  const beforeIndex = beforeId === null ? ids.length : ids.indexOf(beforeId);
  if (beforeIndex === -1) return true;
  return beforeIndex === sourceIndex || beforeIndex === sourceIndex + 1;
};

const moveItemBefore = <TItem, TId extends string>(
  items: readonly TItem[],
  sourceId: TId,
  beforeId: TId | null,
  getId: (item: TItem) => TId,
): TItem[] => {
  const sourceIndex = items.findIndex((item) => getId(item) === sourceId);
  if (sourceIndex === -1) return [...items];
  const next = items.filter((item) => getId(item) !== sourceId);
  if (beforeId === null) {
    next.push(items[sourceIndex]!);
    return next;
  }
  const insertAt = next.findIndex((item) => getId(item) === beforeId);
  if (insertAt === -1) {
    next.push(items[sourceIndex]!);
    return next;
  }
  next.splice(insertAt, 0, items[sourceIndex]!);
  return next;
};

export const applySortableItemMove = <TItem, TId extends string>(input: {
  items: readonly TItem[];
  sourceId: TId;
  targetId: TId;
  half: SortableInsertHalf;
  getId: (item: TItem) => TId;
}): TItem[] | null => {
  const ids = input.items.map(input.getId);
  const beforeId = resolveSortableInsertBeforeId(ids, input.targetId, input.half);
  if (isNoOpSortableMove(ids, input.sourceId, beforeId)) return null;
  return moveItemBefore(input.items, input.sourceId, beforeId, input.getId);
};

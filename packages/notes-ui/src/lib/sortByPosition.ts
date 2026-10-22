/**
 * Notes and folders in library order: by `position`, a missing one counting as the item's
 * index, and equal positions in the given order. The sidebar shows this order and the
 * workspace saves it, so both must sort the same way.
 */
export const sortByPosition = <T extends { position?: number }>(items: readonly T[]) =>
  items
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        (left.item.position ?? left.index) - (right.item.position ?? right.index) ||
        left.index - right.index,
    )
    .map(({ item }) => item);

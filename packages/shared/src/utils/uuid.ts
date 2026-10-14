/** A random id for a note, tab, block or other new item. */
export const createUuid = (): string => crypto.randomUUID();

/** Any UUID, in either case. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

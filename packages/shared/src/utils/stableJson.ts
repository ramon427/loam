const sortJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      // Code-unit order, so the result is the same in every locale.
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)]),
  );
};

export const stableJsonStringify = (value: unknown) => JSON.stringify(sortJsonValue(value ?? null));

/** A plain object read from JSON or other untyped input; arrays and null are not. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

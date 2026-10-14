/** `value` kept within `min` and `max`; `max` wins when the range is empty. */
export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

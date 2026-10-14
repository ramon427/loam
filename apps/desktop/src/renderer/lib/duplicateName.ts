const DUPLICATE_NAME_SUFFIX = /^(.*?)(?:([ \u00a0]*))([(\uFF08])(\d+)([)\uFF09])\s*$/u;

/**
 * Increment a trailing parenthesized number for duplicate/fork titles.
 * "Morning routine" -> "Morning routine (1)"
 * "Morning routine (1)" -> "Morning routine (2)"
 * Fullwidth parentheses keep their style. Names ending in non-count
 * parentheses, such as "Risk (ES)", get " (1)" appended.
 */
export const incrementDuplicateName = (value: string) => {
  const name = value.trim();
  if (!name) return "(1)";

  const match = name.match(DUPLICATE_NAME_SUFFIX);
  if (!match) return `${name} (1)`;

  const [, rawBase, gap, open, digits, close] = match;
  const next = String(Number.parseInt(digits, 10) + 1);
  const prefix = rawBase.trimEnd();
  if (!prefix) return `${open}${next}${close}`;
  return `${prefix}${gap || (open === "(" ? " " : "")}${open}${next}${close}`;
};

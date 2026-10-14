import { isRecord } from "@loam/shared/utils/isRecord";

/*
 * Older versions linked text to a graph, a graph node or edge, a table, or a
 * table row or column (`#note-ref?kind=graph-node&…`, `#note-graph…`). Nothing
 * opens those links any more, so a note shows them as their plain text.
 */

const LEGACY_REFERENCE_KINDS = new Set([
  "table",
  "table-column",
  "table-row",
  "graph",
  "graph-node",
  "graph-edge",
]);

const isLegacyHref = (href: string) => {
  const graphHash = href.indexOf("#note-graph");
  if (graphHash >= 0) return /^#note-graph($|[?&])/.test(href.slice(graphHash));
  const referenceHash = href.indexOf("#note-ref");
  if (referenceHash < 0) return false;
  const hash = href.slice(referenceHash);
  const query = hash.indexOf("?");
  return (
    /^#note-ref[?&]/.test(hash) &&
    query >= 0 &&
    LEGACY_REFERENCE_KINDS.has(new URLSearchParams(hash.slice(query + 1)).get("kind") ?? "")
  );
};

const isLegacyLink = (value: unknown): value is { content: unknown[] | string } =>
  isRecord(value) &&
  value.type === "link" &&
  typeof value.href === "string" &&
  isLegacyHref(value.href) &&
  (Array.isArray(value.content) || typeof value.content === "string");

const flatten = (value: unknown): unknown => {
  if (Array.isArray(value))
    return value.flatMap((item) => {
      if (!isLegacyLink(item)) return [flatten(item)];
      return typeof item.content === "string"
        ? [{ type: "text", text: item.content, styles: {} }]
        : (flatten(item.content) as unknown[]);
    });
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, flatten(child)]));
};

/** The blocks with every legacy link replaced by its text. */
export const flattenLegacyNoteLinks = (blocks: unknown[]): unknown[] =>
  flatten(blocks) as unknown[];

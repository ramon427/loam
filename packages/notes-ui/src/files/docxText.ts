import JSZip from "jszip";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

const decode = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (entity, name: string) => {
    if (name.startsWith("#x")) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
    return ENTITIES[name.toLowerCase()] ?? entity;
  });

/** A Word document's text, a paragraph a line, up to `maxChars`; null when it has none. */
export async function readDocxText(bytes: Uint8Array, maxChars: number) {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return null;
  const paragraphs = xml
    .split(/<\/w:p>/)
    .map((paragraph) =>
      decode(
        [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)]
          .map((match) => match[1] ?? (match[0] === "<w:tab/>" ? "\t" : "\n"))
          .join(""),
      ),
    );
  const text = paragraphs
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? text.slice(0, maxChars) : null;
}

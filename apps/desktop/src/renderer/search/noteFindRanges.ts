/** Find ranges span formatting boundaries without inserting nodes into the editor. */
export function findNoteTextRanges(root: HTMLElement, query: string): Range[] {
  const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const needle = fold(query.trim());
  if (!needle) return [];
  const matches: Range[] = [];
  const containers = root.querySelectorAll(
    ".bn-inline-content, [data-note-header-title] h1:not(:has(input, textarea))",
  );
  for (const container of containers) {
    if (!container.getClientRects().length) continue;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes: Array<{ node: Text; from: number; to: number }> = [];
    let text = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const from = text.length;
      text += node.textContent ?? "";
      nodes.push({ node: node as Text, from, to: text.length });
    }
    let folded = "";
    const starts: number[] = [];
    const ends: number[] = [];
    let originalOffset = 0;
    for (const character of text) {
      const part = fold(character);
      for (let index = 0; index < part.length; index++) {
        starts.push(originalOffset);
        ends.push(originalOffset + character.length);
      }
      folded += part;
      originalOffset += character.length;
    }
    for (
      let index = folded.indexOf(needle);
      index >= 0;
      index = folded.indexOf(needle, index + needle.length)
    ) {
      const from = starts[index]!;
      const to = ends[index + needle.length - 1]!;
      const start = nodes.find((entry) => entry.to > from);
      const end = nodes.find((entry) => entry.to >= to);
      if (!start || !end) continue;
      const range = document.createRange();
      range.setStart(start.node, from - start.from);
      range.setEnd(end.node, to - end.from);
      matches.push(range);
    }
  }
  return matches;
}

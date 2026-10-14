/**
 * 32-bit FNV-1a over a string's UTF-16 code units, from `seed` (FNV's own
 * offset basis by default). Stored history hashes and conflict-copy ids
 * depend on it, so it must never change.
 */
export const fnv1a = (text: string, seed = 0x811c9dc5) => {
  let hash = seed;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};

/** Use the text ID to pick a cover colour so the same book keeps its colour between visits. */

export const COVERS = [
  'saffron',
  'olive',
  'rose',
  'indigo',
  'sepia',
  'paper',
  'plain',
] as const;
export type Cover = (typeof COVERS)[number];

export function coverForId(id: string): Cover {
  let hash = 2166136261; // FNV-1a offset basis
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Coerce to non-negative before modulo.
  const idx = (hash >>> 0) % COVERS.length;
  return COVERS[idx]!;
}

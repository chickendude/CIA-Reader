/**
 * Library card cover-color picker (T-5.13).
 *
 * The CIAR design ships seven cover treatments — saffron, olive, rose,
 * indigo, sepia, paper, plain — and each text gets a stable one based
 * on its id so a user's library doesn't reshuffle colours across page
 * loads. A simple FNV-1a-ish hash over the id codepoints is enough;
 * we don't need cryptographic strength, just deterministic spread.
 */

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

/**
 * UD-feature → display-label lookup for the popup feature pills.
 *
 * Reads the `grammar_features` table once (it's seeded immutable
 * data of ~50 rows) and turns a (POS, features-blob) pair into the
 * pills the popup renders. Caches the table in-process with a
 * short refresh window because the data is effectively static —
 * even a curator-driven schema update is rare enough that paying a
 * cache miss after a few minutes is fine.
 *
 * The seam for "translate one form into pills" lives here so the
 * popup component stays a dumb consumer — it just renders what we
 * hand it, with no UD knowledge baked in.
 */
import { db, schema } from '../db/index.js';
import type { GrammarFeature } from '../db/schema.js';

export type FeaturePill = {
  /** The (key, value) the pill represents — useful for tests +
   *  data attributes the integration tests can target. */
  featKey: string;
  featValue: string;
  shortLabel: string;
  longLabel: string;
};

let cache: { rows: GrammarFeature[]; loadedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Test seam — clears the in-process cache. */
export function _resetGrammarFeatureCacheForTest(): void {
  cache = null;
}

async function loadFeatures(): Promise<GrammarFeature[]> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache.rows;
  const rows = (await db.select().from(schema.grammarFeatures)) as GrammarFeature[];
  cache = { rows, loadedAt: now };
  return rows;
}

/**
 * Turn a (POS, features) blob into ordered display pills.
 *
 *  - `pos` filters the feature catalog: a `Tense` row tagged
 *    `pos_scope=['VERB']` only contributes to a VERB lemma. Empty /
 *    null `pos_scope` means "applies to every POS".
 *  - Unknown (key, value) pairs (e.g. Stanza emitted a feature we
 *    haven't seeded yet) fall through with the raw value as both
 *    short and long label — better to render `Foo` than crash.
 *  - Output is sorted by the catalog's `sort_order` so the popup
 *    always shows pills in the same category order (polarity →
 *    tense → aspect → … → definiteness).
 */
export async function getFeaturePills(
  pos: string,
  features: Record<string, string>,
): Promise<FeaturePill[]> {
  const keys = Object.keys(features);
  if (keys.length === 0) return [];
  const catalog = await loadFeatures();
  // Index by `${key}::${value}` for O(1) lookup against the blob.
  const index = new Map<string, GrammarFeature>();
  for (const row of catalog) {
    index.set(`${row.featKey}::${row.featValue}`, row);
  }
  type Sorted = FeaturePill & { sortOrder: number };
  const pills: Sorted[] = [];
  for (const key of keys) {
    const value = features[key];
    if (value === undefined) continue;
    const row = index.get(`${key}::${value}`);
    if (row) {
      const scopeOk =
        row.posScope.length === 0 || row.posScope.includes(pos);
      if (!scopeOk) continue;
      pills.push({
        featKey: row.featKey,
        featValue: row.featValue,
        shortLabel: row.shortLabel,
        longLabel: row.longLabel,
        sortOrder: row.sortOrder,
      });
    } else {
      // Unknown — surface raw values rather than dropping data; the
      // user still gets useful info, and the missing seed becomes
      // visible.
      pills.push({
        featKey: key,
        featValue: value,
        shortLabel: value,
        longLabel: `${key}=${value}`,
        sortOrder: 9_999,
      });
    }
  }
  pills.sort((a, b) => a.sortOrder - b.sortOrder);
  return pills.map((p) => ({
    featKey: p.featKey,
    featValue: p.featValue,
    shortLabel: p.shortLabel,
    longLabel: p.longLabel,
  }));
}

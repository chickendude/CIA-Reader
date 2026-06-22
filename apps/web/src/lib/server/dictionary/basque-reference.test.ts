// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  elhuyarUrl,
  euskaltzaindiaUrl,
  isBasqueReferenceSource,
  lookupBasqueReference,
  parseElhuyar,
  parseElhuyarAutocomplete,
  parseEuskaltzaindia,
  searchElhuyarAutocomplete,
  type FetchImpl,
  type ReferenceCache,
  type ReferenceCacheEntry,
} from './basque-reference.js';

const AUTOCOMPLETE_JSON = JSON.stringify([
  { value: '/eu_es/Afrika', label: "<span class='sarrera'>Afrika</span>" },
  { value: '/eu_es/Afrika Erdiko Errepublika', label: 'x' },
  { value: '/eu_es/afrikaans', label: 'x' },
  { value: '/eu_es/afrikaans', label: 'dup dropped' },
  { label: 'no value — skipped' },
]);

/** In-memory ReferenceCache for exercising the cache path without a DB. */
function memoryCache() {
  const store = new Map<string, ReferenceCacheEntry>();
  const key = (w: string, s: string) => `${s}:${w}`;
  const cache: ReferenceCache = {
    async get(word, source) {
      return store.get(key(word, source)) ?? null;
    },
    async set(word, source, results, now) {
      store.set(key(word, source), { results, fetchedAt: now });
    },
  };
  return { cache, store, key };
}

// Minimal HTML mirroring the upstream selectors the parser relies on.
const ELHUYAR_ES_HTML = `
  <div class="emaitza-lerroa hizkuntza-eu_es"><h1>1 etxe</h1></div>
  <ul class="hizkuntza-eu_es">
    <li>
      <p class="lehena"><em>iz.</em> casa <a style="color:red">[noise]</a><i class="fa"></i></p>
      <div class="padDefn"><p class="text-muted">etxe handia : casa grande</p></div>
    </li>
    <li>
      <p class="lehena"><em>iz.</em> hogar</p>
    </li>
  </ul>
  <ul class="hizkuntza-eu_en">
    <li><p class="lehena"><em>n.</em> house</p></li>
  </ul>
`;

const EUSKALTZAINDIA_HTML = `
  <div class="sarrera">
    <div class="sarrera-burua"><b>etxe</b></div>
    <div class="adiera">
      <span class="sense-n">1</span>
      <span class="laburdura-pos">iz.</span>
      <span class="def">Bizitzeko eraikina.</span>
      <div class="dicteg"><i>Etxe berria erosi dute.</i></div>
    </div>
    <div class="adiera">
      <span class="def">Familia.</span>
    </div>
  </div>
`;

describe('isBasqueReferenceSource', () => {
  it('accepts the three known sources and rejects others', () => {
    expect(isBasqueReferenceSource('elhuyar_es')).toBe(true);
    expect(isBasqueReferenceSource('elhuyar_en')).toBe(true);
    expect(isBasqueReferenceSource('euskaltzaindia')).toBe(true);
    expect(isBasqueReferenceSource('google')).toBe(false);
  });
});

describe('parseElhuyar', () => {
  const url = elhuyarUrl('etxe');

  it('extracts headword, POS, definition and examples; strips noise', () => {
    const results = parseElhuyar(ELHUYAR_ES_HTML, 'elhuyar_es', 'etxe', url);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      source: 'elhuyar_es',
      label: 'Elhuyar eu-es',
      headword: 'etxe', // leading "1 " number stripped
      pos: 'iz.',
      definition: 'casa', // <a style> + <i.fa> noise removed
      examples: ['etxe handia : casa grande'],
      url,
    });
    expect(results[1]!.definition).toBe('hogar');
  });

  it('reads only the requested language list', () => {
    const en = parseElhuyar(ELHUYAR_ES_HTML, 'elhuyar_en', 'etxe', elhuyarUrl('etxe'));
    expect(en).toHaveLength(1);
    expect(en[0]).toMatchObject({ label: 'Elhuyar eu-en', definition: 'house' });
  });
});

describe('parseEuskaltzaindia', () => {
  it('extracts senses with number-prefixed definitions and examples', () => {
    const url = euskaltzaindiaUrl('etxe');
    const results = parseEuskaltzaindia(EUSKALTZAINDIA_HTML, 'etxe', url);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      source: 'euskaltzaindia',
      label: 'Euskaltzaindiaren Hiztegia',
      headword: 'etxe',
      pos: 'iz.',
      definition: '1. Bizitzeko eraikina.',
      examples: ['Etxe berria erosi dute.'],
    });
    // Second sense has no number and no examples.
    expect(results[1]).toMatchObject({ definition: 'Familia.', examples: [] });
  });
});

describe('elhuyarUrl case handling', () => {
  it('lowercases by default but preserves case when asked', () => {
    expect(elhuyarUrl('Afrika')).toContain('/afrika');
    expect(elhuyarUrl('Afrika', { preserveCase: true })).toContain('/Afrika');
  });
});

describe('parseElhuyarAutocomplete', () => {
  it('extracts terms from value, preserving case, deduped + skipping bad rows', () => {
    expect(parseElhuyarAutocomplete(AUTOCOMPLETE_JSON)).toEqual([
      'Afrika',
      'Afrika Erdiko Errepublika',
      'afrikaans',
    ]);
  });

  it('returns [] for non-JSON or non-array payloads', () => {
    expect(parseElhuyarAutocomplete('not json')).toEqual([]);
    expect(parseElhuyarAutocomplete('{"value":"/eu_es/x"}')).toEqual([]);
  });
});

describe('searchElhuyarAutocomplete', () => {
  it('queries Elhuyar autocomplete and returns parsed terms', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => AUTOCOMPLETE_JSON,
    })) as ReturnType<typeof vi.fn> & FetchImpl;
    const terms = await searchElhuyarAutocomplete('afrika', { fetchImpl });
    expect(terms).toEqual(['Afrika', 'Afrika Erdiko Errepublika', 'afrikaans']);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('autocomplete');
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('hizkuntza=eu_es');
  });

  it('returns [] for an empty term without fetching', async () => {
    const fetchImpl = vi.fn() as ReturnType<typeof vi.fn> & FetchImpl;
    expect(await searchElhuyarAutocomplete('  ', { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('lookupBasqueReference', () => {
  afterEach(() => vi.restoreAllMocks());

  function htmlFor(url: string): string {
    return url.includes('euskaltzaindia') ? EUSKALTZAINDIA_HTML : ELHUYAR_ES_HTML;
  }

  function mockFetch(): ReturnType<typeof vi.fn> & FetchImpl {
    return vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () => htmlFor(url),
    })) as ReturnType<typeof vi.fn> & FetchImpl;
  }

  const DAY = 24 * 60 * 60 * 1000;

  it('preserves case in the upstream URL only when preserveCase is set', async () => {
    const lower = mockFetch();
    await lookupBasqueReference('Afrika', ['elhuyar_es'], { fetchImpl: lower });
    expect(String(lower.mock.calls[0]![0])).toContain('/afrika');

    const exact = mockFetch();
    await lookupBasqueReference('Afrika', ['elhuyar_es'], {
      fetchImpl: exact,
      preserveCase: true,
    });
    expect(String(exact.mock.calls[0]![0])).toContain('/Afrika');
  });

  it('fetches + parses the requested sources and writes them to the cache', async () => {
    const fetchImpl = mockFetch();
    const { cache, store, key } = memoryCache();
    const out = await lookupBasqueReference('etxe', ['elhuyar_es', 'euskaltzaindia'], {
      fetchImpl,
      now: 1000,
      cache,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out.some((r) => r.source === 'elhuyar_es')).toBe(true);
    expect(out.some((r) => r.source === 'euskaltzaindia')).toBe(true);
    // Both (word, source) entries were persisted to the global cache.
    expect(store.get(key('etxe', 'elhuyar_es'))).toBeDefined();
    expect(store.get(key('etxe', 'euskaltzaindia'))).toBeDefined();
  });

  it('serves a repeated lookup from the cache within the TTL (no second fetch)', async () => {
    const fetchImpl = mockFetch();
    const { cache } = memoryCache();
    await lookupBasqueReference('etxe', ['elhuyar_es'], { fetchImpl, now: 1000, cache });
    await lookupBasqueReference('etxe', ['elhuyar_es'], { fetchImpl, now: 2000, cache });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('re-fetches once the cached entry is older than the TTL', async () => {
    const fetchImpl = mockFetch();
    const { cache } = memoryCache();
    await lookupBasqueReference('etxe', ['elhuyar_es'], { fetchImpl, now: 0, cache });
    await lookupBasqueReference('etxe', ['elhuyar_es'], {
      fetchImpl,
      now: 30 * DAY + 1,
      cache,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('shares the cache across calls regardless of which admin triggered it', async () => {
    const fetchImpl = mockFetch();
    const { cache } = memoryCache();
    // Warm the cache once...
    await lookupBasqueReference('etxe', ['elhuyar_es'], { fetchImpl, now: 1000, cache });
    // ...a *different* fetch impl proves the second lookup never hit the network.
    const fetchImpl2 = mockFetch();
    await lookupBasqueReference('etxe', ['elhuyar_es'], { fetchImpl: fetchImpl2, now: 2000, cache });
    expect(fetchImpl2).not.toHaveBeenCalled();
  });

  it('defaults to no caching when no cache is supplied (always fetches)', async () => {
    const fetchImpl = mockFetch();
    await lookupBasqueReference('etxe', ['elhuyar_es'], { fetchImpl, now: 1000 });
    await lookupBasqueReference('etxe', ['elhuyar_es'], { fetchImpl, now: 2000 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('skips a failing source instead of throwing', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('euskaltzaindia')) return { ok: false, status: 503, text: async () => '' };
      return { ok: true, status: 200, text: async () => htmlFor(url) };
    }) as unknown as FetchImpl;
    const { cache } = memoryCache();
    const out = await lookupBasqueReference('etxe', ['euskaltzaindia', 'elhuyar_es'], {
      fetchImpl,
      now: 1000,
      cache,
    });
    // Euskaltzaindia failed; Elhuyar still came back.
    expect(out.every((r) => r.source === 'elhuyar_es')).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });

  it('returns nothing for a blank word without fetching', async () => {
    const fetchImpl = mockFetch();
    expect(await lookupBasqueReference('   ', ['elhuyar_es'], { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('normalizes the word to lowercase for cache keying', async () => {
    const fetchImpl = mockFetch();
    const { cache, store, key } = memoryCache();
    await lookupBasqueReference('Etxe', ['elhuyar_es'], { fetchImpl, now: 1000, cache });
    expect(store.get(key('etxe', 'elhuyar_es'))).toBeDefined();
  });
});

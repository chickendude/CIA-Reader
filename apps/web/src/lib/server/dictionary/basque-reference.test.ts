// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _clearBasqueReferenceCache,
  elhuyarUrl,
  euskaltzaindiaUrl,
  isBasqueReferenceSource,
  lookupBasqueReference,
  parseElhuyar,
  parseEuskaltzaindia,
  type FetchImpl,
} from './basque-reference.js';

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

describe('lookupBasqueReference', () => {
  beforeEach(() => _clearBasqueReferenceCache());
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

  it('fetches + parses the requested sources', async () => {
    const fetchImpl = mockFetch();
    const out = await lookupBasqueReference('etxe', ['elhuyar_es', 'euskaltzaindia'], {
      fetchImpl,
      now: 1000,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out.some((r) => r.source === 'elhuyar_es')).toBe(true);
    expect(out.some((r) => r.source === 'euskaltzaindia')).toBe(true);
  });

  it('serves a repeated lookup from the cache within the TTL', async () => {
    const fetchImpl = mockFetch();
    await lookupBasqueReference('etxe', ['elhuyar_es'], { fetchImpl, now: 1000 });
    await lookupBasqueReference('etxe', ['elhuyar_es'], { fetchImpl, now: 2000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('re-fetches once the cache entry is older than the TTL', async () => {
    const fetchImpl = mockFetch();
    const day = 24 * 60 * 60 * 1000;
    await lookupBasqueReference('etxe', ['elhuyar_es'], { fetchImpl, now: 0 });
    await lookupBasqueReference('etxe', ['elhuyar_es'], { fetchImpl, now: day + 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('skips a failing source instead of throwing', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('euskaltzaindia')) return { ok: false, status: 503, text: async () => '' };
      return { ok: true, status: 200, text: async () => htmlFor(url) };
    }) as unknown as FetchImpl;
    const out = await lookupBasqueReference('etxe', ['euskaltzaindia', 'elhuyar_es'], {
      fetchImpl,
      now: 1000,
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
});

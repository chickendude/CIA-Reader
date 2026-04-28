// @vitest-environment node
/**
 * Unit tests for `bucketTranslations` (T-3.3).
 *
 * The ordering contract is the important thing — covered with literal
 * rows. The DB-backed `getLemmaTranslations` is an integration concern
 * exercised end-to-end in the endpoint test below; here we keep the
 * sorter alone.
 */
import { describe, expect, it } from 'vitest';

import { bucketTranslations, deriveProvenance } from './lookups.js';
import type { Translation } from '../db/schema.js';

let _id = 0;
function row(overrides: Partial<Translation>): Translation {
  _id += 1;
  return {
    id: `tr-${_id}`,
    lemmaId: 'lemma-1',
    source: 'official_dictionary',
    submittedBy: null,
    parentTranslationId: null,
    body: 'gloss',
    targetLanguage: 'en',
    sourceAttribution: null,
    sourceId: null,
    hidden: false,
    displayRank: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Translation;
}

describe('bucketTranslations — classification', () => {
  it('splits rows into personal / official / community for an authenticated viewer', () => {
    const rows: Translation[] = [
      row({ source: 'official_dictionary', body: 'off' }),
      row({ source: 'curator', body: 'cur' }),
      row({ source: 'user', submittedBy: 'u1', body: 'mine' }),
      row({ source: 'user', submittedBy: 'u2', body: 'theirs' }),
    ];
    const out = bucketTranslations(rows, { id: 'u1', role: 'user' });
    expect(out.personal.map((t) => t.body)).toEqual(['mine']);
    expect(out.official.map((t) => t.body).sort()).toEqual(['cur', 'off']);
    expect(out.community.map((t) => t.body)).toEqual(['theirs']);
  });

  it('treats every user-submitted row as community when the viewer is anonymous', () => {
    const rows: Translation[] = [
      row({ source: 'user', submittedBy: 'u1', body: 'a' }),
      row({ source: 'user', submittedBy: 'u2', body: 'b' }),
    ];
    const out = bucketTranslations(rows, null);
    expect(out.personal).toEqual([]);
    expect(out.community.map((t) => t.body).sort()).toEqual(['a', 'b']);
  });
});

describe('bucketTranslations — ordering', () => {
  it('orders officials with curator rows ahead of raw imports', () => {
    const rows: Translation[] = [
      row({
        source: 'official_dictionary',
        body: 'imp',
        createdAt: new Date('2025-12-01'),
      }),
      row({
        source: 'curator',
        body: 'cur',
        createdAt: new Date('2026-03-01'),
      }),
    ];
    const out = bucketTranslations(rows, null);
    expect(out.official.map((t) => t.body)).toEqual(['cur', 'imp']);
  });

  it('orders community translations newest-first as a temporary stand-in for vote order', () => {
    const rows: Translation[] = [
      row({
        source: 'user',
        submittedBy: 'u2',
        body: 'old',
        createdAt: new Date('2026-01-01'),
      }),
      row({
        source: 'user',
        submittedBy: 'u3',
        body: 'new',
        createdAt: new Date('2026-04-01'),
      }),
    ];
    const out = bucketTranslations(rows, null);
    expect(out.community.map((t) => t.body)).toEqual(['new', 'old']);
  });

  it('honors curator-set displayRank ahead of source-rank within officials (T-3.13)', () => {
    const rows: Translation[] = [
      row({
        source: 'curator',
        body: 'cur-second',
        displayRank: 1,
        createdAt: new Date('2026-01-01'),
      }),
      row({
        source: 'official_dictionary',
        body: 'imp-first',
        displayRank: 0,
        createdAt: new Date('2025-12-01'),
      }),
    ];
    const out = bucketTranslations(rows, null);
    // Without ranks the curator row would sort first; ranks override.
    expect(out.official.map((t) => t.body)).toEqual(['imp-first', 'cur-second']);
  });

  it('falls back to source-rank when displayRank is null (T-3.13)', () => {
    // Same setup as the non-rank test above but with all ranks null —
    // proves the displayRank path doesn't disturb existing behavior.
    const rows: Translation[] = [
      row({
        source: 'official_dictionary',
        body: 'imp',
        displayRank: null,
        createdAt: new Date('2025-12-01'),
      }),
      row({
        source: 'curator',
        body: 'cur',
        displayRank: null,
        createdAt: new Date('2026-03-01'),
      }),
    ];
    const out = bucketTranslations(rows, null);
    expect(out.official.map((t) => t.body)).toEqual(['cur', 'imp']);
  });

  it('places null-rank rows after non-null within the same bucket (T-3.13)', () => {
    const rows: Translation[] = [
      row({
        source: 'official_dictionary',
        body: 'unranked',
        displayRank: null,
        createdAt: new Date('2025-12-01'),
      }),
      row({
        source: 'official_dictionary',
        body: 'ranked',
        displayRank: 5,
        createdAt: new Date('2026-04-01'),
      }),
    ];
    const out = bucketTranslations(rows, null);
    expect(out.official.map((t) => t.body)).toEqual(['ranked', 'unranked']);
  });

  it('honors displayRank within the community bucket too (T-3.13)', () => {
    const rows: Translation[] = [
      row({
        source: 'user',
        submittedBy: 'u2',
        body: 'pinned',
        displayRank: 0,
        createdAt: new Date('2026-01-01'),
      }),
      row({
        source: 'user',
        submittedBy: 'u3',
        body: 'newer',
        displayRank: null,
        createdAt: new Date('2026-04-01'),
      }),
    ];
    const out = bucketTranslations(rows, null);
    // The community bucket would normally put the newer row first; the
    // curator's pin overrides.
    expect(out.community.map((t) => t.body)).toEqual(['pinned', 'newer']);
  });

  it('orders personal translations oldest-first (stable across renders)', () => {
    const rows: Translation[] = [
      row({
        source: 'user',
        submittedBy: 'u1',
        body: 'new-fork',
        createdAt: new Date('2026-04-01'),
      }),
      row({
        source: 'user',
        submittedBy: 'u1',
        body: 'old-fork',
        createdAt: new Date('2026-01-01'),
      }),
    ];
    const out = bucketTranslations(rows, { id: 'u1', role: 'user' });
    expect(out.personal.map((t) => t.body)).toEqual(['old-fork', 'new-fork']);
  });
});

describe('deriveProvenance — viewer-relative classification (T-3.8)', () => {
  it('returns personal/null when the viewer authored the row', () => {
    const r = row({ source: 'user', submittedBy: 'u1' });
    expect(deriveProvenance(r, { id: 'u1' })).toEqual({
      kind: 'personal',
      attribution: null,
    });
  });

  it('returns community/null when another user authored the row', () => {
    const r = row({ source: 'user', submittedBy: 'u2' });
    expect(deriveProvenance(r, { id: 'u1' })).toEqual({
      kind: 'community',
      attribution: null,
    });
  });

  it('returns community/null for a user-row when the viewer is anonymous', () => {
    const r = row({ source: 'user', submittedBy: 'u2' });
    expect(deriveProvenance(r, null)).toEqual({
      kind: 'community',
      attribution: null,
    });
  });

  it('returns curator with the row attribution', () => {
    const r = row({ source: 'curator', sourceAttribution: 'CIA Reader curators' });
    expect(deriveProvenance(r, null)).toEqual({
      kind: 'curator',
      attribution: 'CIA Reader curators',
    });
  });

  it('returns imported with upstream attribution preserved verbatim', () => {
    const r = row({
      source: 'official_dictionary',
      sourceAttribution: 'Hindi WordNet (CFILT, IIT-Bombay)',
    });
    expect(deriveProvenance(r, { id: 'u1' })).toEqual({
      kind: 'imported',
      attribution: 'Hindi WordNet (CFILT, IIT-Bombay)',
    });
  });
});

describe('bucketTranslations — provenance attached to every public row', () => {
  it('attaches the right kind to each bucket', () => {
    const rows: Translation[] = [
      row({ source: 'official_dictionary', sourceAttribution: 'Molesworth' }),
      row({ source: 'curator' }),
      row({ source: 'user', submittedBy: 'me' }),
      row({ source: 'user', submittedBy: 'them' }),
    ];
    const out = bucketTranslations(rows, { id: 'me', role: 'user' });
    expect(out.personal[0]!.provenance.kind).toBe('personal');
    expect(out.official.map((t) => t.provenance.kind).sort()).toEqual([
      'curator',
      'imported',
    ]);
    expect(out.community[0]!.provenance.kind).toBe('community');
  });
});

describe('bucketTranslations — moderation visibility', () => {
  it('hides `hidden=true` community rows from anonymous viewers', () => {
    const rows: Translation[] = [
      row({ source: 'user', submittedBy: 'u2', body: 'visible' }),
      row({ source: 'user', submittedBy: 'u3', body: 'hidden', hidden: true }),
    ];
    const out = bucketTranslations(rows, null);
    expect(out.community.map((t) => t.body)).toEqual(['visible']);
  });

  it('hides `hidden=true` community rows from regular users', () => {
    const rows: Translation[] = [
      row({ source: 'user', submittedBy: 'u2', body: 'visible' }),
      row({ source: 'user', submittedBy: 'u3', body: 'hidden', hidden: true }),
    ];
    const out = bucketTranslations(rows, { id: 'u1', role: 'user' });
    expect(out.community.map((t) => t.body)).toEqual(['visible']);
  });

  it('shows hidden rows to curators and admins so they can review', () => {
    const rows: Translation[] = [
      row({ source: 'user', submittedBy: 'u2', body: 'visible' }),
      row({ source: 'user', submittedBy: 'u3', body: 'hidden', hidden: true }),
    ];
    const curator = bucketTranslations(rows, { id: 'mod', role: 'curator' });
    expect(curator.community.map((t) => t.body).sort()).toEqual(['hidden', 'visible']);
    const admin = bucketTranslations(rows, { id: 'adm', role: 'admin' });
    expect(admin.community.map((t) => t.body).sort()).toEqual(['hidden', 'visible']);
  });
});

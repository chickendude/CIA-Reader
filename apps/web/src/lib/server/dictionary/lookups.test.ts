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

import { bucketTranslations } from './lookups.js';
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

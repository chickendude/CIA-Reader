// @vitest-environment node
/**
 * Runner unit tests (T-3.1).
 *
 * The runner is a small orchestrator over `DictionaryRepo`; every test
 * here wires it to `InMemoryDictionaryRepo` and asserts on counts +
 * row contents. No Postgres, no Drizzle.
 */
import { describe, expect, it } from 'vitest';

import { runDictionaryImport } from './runner.js';
import { hindiSeedSource } from './sources/hindi-seed.js';
import { InMemoryDictionaryRepo } from './test-support.js';
import type { DictionaryImportSource, ImportEntry } from './types.js';

function makeSource(
  entries: ImportEntry[],
  overrides: Partial<DictionaryImportSource> = {},
): DictionaryImportSource {
  return {
    name: 'test-source',
    language: 'hi',
    sourceAttribution: 'Test Source',
    license: 'CC0-1.0',
    entries: () => entries,
    ...overrides,
  };
}

const baseEntry: ImportEntry = {
  sourceId: 'test:lemma-1',
  headword: 'परीक्षा',
  pos: 'NOUN',
  script: 'Deva',
  glossDefault: 'test, examination',
  translations: [{ sourceId: 'test:lemma-1:en:1', body: 'test' }],
};

describe('runDictionaryImport — fresh import', () => {
  it('creates lemmas, translations, and forms, and records the audit row', async () => {
    const repo = new InMemoryDictionaryRepo();
    const result = await runDictionaryImport(repo, hindiSeedSource);

    expect(result.lemmasCreated).toBe(10);
    expect(result.lemmasUpdated).toBe(0);
    expect(result.lemmasSkippedCuratorLocked).toBe(0);
    // Each entry has ≥1 translation; the "bolna" entry has 2.
    expect(result.translationsCreated).toBe(11);
    expect(result.translationsUpdated).toBe(0);
    // Only the sona-verb entry ships forms (2 of them).
    expect(result.formsCreated).toBe(2);

    expect(repo.lemmas.size).toBe(10);
    expect(repo.translations.size).toBe(11);
    expect(repo.forms).toHaveLength(2);
    expect(repo.audit).toHaveLength(1);
    expect(repo.audit[0]).toMatchObject({
      sourceName: 'hindi-seed',
      language: 'hi',
      lemmasCreated: 10,
      translationsCreated: 11,
    });
  });

  it('stores homograph headwords as distinct lemma rows keyed by POS', async () => {
    const repo = new InMemoryDictionaryRepo();
    await runDictionaryImport(repo, hindiSeedSource);

    const sonaRows = [...repo.lemmas.values()].filter((l) => l.headword === 'सोना');
    expect(sonaRows).toHaveLength(2);
    expect(sonaRows.map((l) => l.pos).sort()).toEqual(['NOUN', 'VERB']);
    // Distinct ids — proves the upsert key includes POS.
    expect(sonaRows[0]!.id).not.toBe(sonaRows[1]!.id);
  });

  it('tags every written row with source=official_dictionary and the attribution string', async () => {
    const repo = new InMemoryDictionaryRepo();
    await runDictionaryImport(repo, hindiSeedSource);

    for (const lemma of repo.lemmas.values()) {
      expect(lemma.source).toBe('official_dictionary');
      expect(lemma.sourceAttribution).toBe(hindiSeedSource.sourceAttribution);
      expect(lemma.curatorLocked).toBe(false);
    }
    for (const tr of repo.translations.values()) {
      expect(tr.source).toBe('official_dictionary');
      expect(tr.targetLanguage).toBe('en');
    }
  });
});

describe('runDictionaryImport — idempotency', () => {
  it('updates rows on re-run rather than duplicating them', async () => {
    const repo = new InMemoryDictionaryRepo();
    await runDictionaryImport(repo, hindiSeedSource);
    const lemmaCountAfterFirst = repo.lemmas.size;
    const translationCountAfterFirst = repo.translations.size;

    const second = await runDictionaryImport(repo, hindiSeedSource);

    expect(second.lemmasCreated).toBe(0);
    expect(second.lemmasUpdated).toBe(10);
    expect(second.translationsCreated).toBe(0);
    expect(second.translationsUpdated).toBe(11);
    // Forms are append-only at MVP — re-running adds them again.
    expect(second.formsCreated).toBe(2);
    expect(repo.lemmas.size).toBe(lemmaCountAfterFirst);
    expect(repo.translations.size).toBe(translationCountAfterFirst);
    expect(repo.audit).toHaveLength(2);
  });

  it('picks up upstream field changes on re-import', async () => {
    const repo = new InMemoryDictionaryRepo();
    await runDictionaryImport(repo, makeSource([baseEntry]));

    const updatedEntry: ImportEntry = {
      ...baseEntry,
      glossDefault: 'test, examination, assessment',
      frequencyRank: 42,
      translations: [
        { sourceId: 'test:lemma-1:en:1', body: 'test, examination' }, // updated body
      ],
    };
    await runDictionaryImport(repo, makeSource([updatedEntry]));

    const lemma = [...repo.lemmas.values()][0]!;
    expect(lemma.glossDefault).toBe('test, examination, assessment');
    expect(lemma.frequencyRank).toBe(42);
    const translation = [...repo.translations.values()][0]!;
    expect(translation.body).toBe('test, examination');
  });
});

describe('runDictionaryImport — curator-lock invariant', () => {
  it('skips curator-locked rows without touching them', async () => {
    const repo = new InMemoryDictionaryRepo();
    const locked = repo.seedCuratorLocked({
      language: 'hi',
      headword: 'पानी',
      pos: 'NOUN',
      script: 'Deva',
      glossDefault: 'curator-edited gloss',
      frequencyRank: 999,
      source: 'official_dictionary',
      sourceAttribution: 'Hand-edited by curator',
      sourceId: 'hi-seed:pani',
    });

    const result = await runDictionaryImport(repo, hindiSeedSource);

    expect(result.lemmasSkippedCuratorLocked).toBe(1);
    // 10 entries total, 1 skipped → 9 inserted.
    expect(result.lemmasCreated).toBe(9);

    const stillLocked = repo.lemmas.get(locked.id);
    expect(stillLocked).toBeDefined();
    expect(stillLocked!.glossDefault).toBe('curator-edited gloss');
    expect(stillLocked!.frequencyRank).toBe(999);
    expect(stillLocked!.sourceAttribution).toBe('Hand-edited by curator');
    expect(stillLocked!.curatorLocked).toBe(true);
  });

  it('does not emit translations or forms for a curator-locked lemma', async () => {
    const repo = new InMemoryDictionaryRepo();
    repo.seedCuratorLocked({
      language: 'hi',
      headword: 'सोना',
      pos: 'VERB',
      script: 'Deva',
      glossDefault: 'to sleep',
      frequencyRank: 260,
      source: 'official_dictionary',
      sourceAttribution: 'Curator',
      sourceId: 'hi-seed:sona-verb',
    });

    await runDictionaryImport(repo, hindiSeedSource);

    // The sona-verb entry ships 1 translation + 2 forms; neither should
    // land because the runner skipped the lemma entirely.
    const translationsForSonaVerb = [...repo.translations.values()].filter((t) =>
      t.sourceId?.startsWith('hi-seed:sona-verb'),
    );
    expect(translationsForSonaVerb).toHaveLength(0);
    const sonaVerbLemmaId = [...repo.lemmas.values()].find(
      (l) => l.headword === 'सोना' && l.pos === 'VERB',
    )!.id;
    const formsForSonaVerb = repo.forms.filter((f) => f.lemmaId === sonaVerbLemmaId);
    expect(formsForSonaVerb).toHaveLength(0);
  });
});

describe('runDictionaryImport — iterable shapes', () => {
  it('accepts an async iterable source', async () => {
    async function* gen(): AsyncIterable<ImportEntry> {
      yield baseEntry;
      yield { ...baseEntry, sourceId: 'test:lemma-2', headword: 'गुरु' };
    }
    const source = makeSource([], { entries: () => gen() });
    const repo = new InMemoryDictionaryRepo();
    const result = await runDictionaryImport(repo, source);

    expect(result.lemmasCreated).toBe(2);
    expect(repo.lemmas.size).toBe(2);
  });
});

describe('runDictionaryImport — translation attribution', () => {
  it('falls back to the source attribution when per-translation override is absent', async () => {
    const repo = new InMemoryDictionaryRepo();
    await runDictionaryImport(repo, makeSource([baseEntry]));
    const tr = [...repo.translations.values()][0]!;
    expect(tr.sourceAttribution).toBe('Test Source');
  });

  it('honours a per-translation attribution override', async () => {
    const entry: ImportEntry = {
      ...baseEntry,
      translations: [
        {
          sourceId: 'test:lemma-1:en:1',
          body: 'test',
          sourceAttribution: 'Overridden attribution',
        },
      ],
    };
    const repo = new InMemoryDictionaryRepo();
    await runDictionaryImport(repo, makeSource([entry]));
    const tr = [...repo.translations.values()][0]!;
    expect(tr.sourceAttribution).toBe('Overridden attribution');
  });
});

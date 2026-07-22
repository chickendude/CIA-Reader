// @vitest-environment node
/**
 * Unit tests for verifyTranscription — the workbench's publish action.
 * The repo is a fake, so these pin the semantics: attribution rewrite,
 * lock, sense reconcile (edit/insert/delete/reorder), scan-ref upsert,
 * and the single transcription_verify audit row.
 */
import { describe, expect, it } from 'vitest';

import { configForLemma, verifyTranscription } from './transcribe.js';
import type { TranscribeRepo, VerifyTranscriptionInput } from './transcribe.js';
import { CuratorValidationError } from './curator.js';
import type { Lemma, ScanPage, Translation } from '../db/schema.js';

const ADMIN = { id: 'admin-1', role: 'admin' as const };

const lemma = (overrides: Partial<Lemma> = {}): Lemma =>
  ({
    id: 'lemma-1',
    language: 'or',
    headword: 'ଅଭିଧାନ',
    pos: 'NOUN',
    script: 'Orya',
    glossDefault: 'draft gloss',
    frequencyRank: null,
    source: 'official_dictionary',
    sourceAttribution: 'Praharaj ... via DSAL — public domain in India & EU',
    sourceId: 'dsal:praharaj:ଅଭିଧାନ:495:0',
    curatorLocked: false,
    stem: null,
    paradigmId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Lemma;

const translation = (id: string, body: string): Translation =>
  ({
    id,
    targetType: 'lemma',
    targetId: 'lemma-1',
    source: 'official_dictionary',
    submittedBy: null,
    parentTranslationId: null,
    body,
    targetLanguage: 'en',
    sourceAttribution: 'via DSAL',
    sourceId: `dsal:praharaj:ଅଭିଧାନ:495:0:s${id}`,
    hidden: false,
    isPrivate: false,
    displayRank: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as Translation;

const scanPage = (): ScanPage =>
  ({
    id: 'page-1',
    volumeId: 'vol-1',
    pdfPageIndex: 500,
    printedPage: 495,
    imageKey: 'scans/dsal-praharaj/v01/pages/500.jpg',
    imageMime: 'image/jpeg',
    width: 1700,
    height: 2200,
    ocrStatus: 'ok',
    ocrEngine: 'vision-raw',
    ocrText: '',
    ocrWords: [],
    ocrAt: new Date(),
    createdAt: new Date(),
  }) as ScanPage;

type FakeState = {
  lemma: Lemma;
  translations: Translation[];
  updates: Array<Record<string, unknown>>;
  translationUpdates: Array<{ id: string; set: Record<string, unknown> }>;
  inserted: Array<Record<string, unknown>>;
  deleted: string[];
  scanRefs: Array<{ lemmaId: string; scanPageId: string; crop: unknown; userId: string }>;
  audits: Array<{ changeType: string; change: Record<string, unknown> }>;
};

function makeRepo(state: Partial<FakeState> = {}): { repo: TranscribeRepo; state: FakeState } {
  const s: FakeState = {
    lemma: lemma(),
    translations: [translation('t1', 'Speaking.'), translation('t2', 'Name.')],
    updates: [],
    translationUpdates: [],
    inserted: [],
    deleted: [],
    scanRefs: [],
    audits: [],
    ...state,
  };
  const repo: TranscribeRepo = {
    loadLemma: async () => s.lemma,
    loadOfficialTranslations: async () => s.translations,
    loadScanPage: async () => scanPage(),
    updateLemma: async (_id, set) => {
      s.updates.push(set as Record<string, unknown>);
      s.lemma = { ...s.lemma, ...set } as Lemma;
      return s.lemma;
    },
    updateTranslation: async (id, set) => {
      s.translationUpdates.push({ id, set: set as unknown as Record<string, unknown> });
      return { ...translation(id, set.body) };
    },
    insertTranslation: async (values) => {
      s.inserted.push(values as unknown as Record<string, unknown>);
      return translation(`new-${s.inserted.length}`, values.body);
    },
    deleteTranslations: async (ids) => {
      s.deleted.push(...ids);
    },
    upsertScanRef: async (lemmaId, scanPageId, crop, userId) => {
      s.scanRefs.push({ lemmaId, scanPageId, crop, userId });
    },
    recordEdit: async (input) => {
      s.audits.push({ changeType: input.changeType, change: input.change as Record<string, unknown> });
    },
  };
  return { repo, state: s };
}

const INPUT: VerifyTranscriptionInput = {
  headword: 'ଅଭିଧାନ',
  pos: 'NOUN',
  senses: [
    { translationId: 't1', body: 'Speaking; utterance.' },
    { body: 'Vocabulary; dictionary; lexicon.', targetLanguage: 'en' },
  ],
  scanPageId: 'page-1',
  crop: { x: 0.1, y: 0.2, w: 0.35, h: 0.08 },
};

describe('verifyTranscription', () => {
  it('locks the lemma and rewrites attribution to the transcription string with the printed page', async () => {
    const { repo, state } = makeRepo();
    await verifyTranscription(ADMIN, 'lemma-1', INPUT, 'verified against scan', repo);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({
      curatorLocked: true,
      headword: 'ଅଭିଧାନ',
      sourceAttribution:
        'Transcribed from Praharaj, Purnnachandra Ordia Bhashakosha (1931–40), p. 495, from the public-domain scan — CIA Reader transcription',
    });
  });

  it('reconciles senses: updates kept rows, inserts new ones, deletes omitted ones, ranks in order', async () => {
    const { repo, state } = makeRepo();
    await verifyTranscription(ADMIN, 'lemma-1', INPUT, '', repo);
    // t1 kept + updated at rank 0.
    expect(state.translationUpdates).toEqual([
      {
        id: 't1',
        set: expect.objectContaining({ body: 'Speaking; utterance.', displayRank: 0 }),
      },
    ]);
    // New sense inserted at rank 1 with a :v<i> source id.
    expect(state.inserted).toEqual([
      expect.objectContaining({
        body: 'Vocabulary; dictionary; lexicon.',
        displayRank: 1,
        sourceId: 'dsal:praharaj:ଅଭିଧାନ:495:0:v1',
      }),
    ]);
    // t2 was omitted from the input → deleted.
    expect(state.deleted).toEqual(['t2']);
  });

  it('saves the crop ref and writes one transcription_verify audit row with before/after', async () => {
    const { repo, state } = makeRepo();
    await verifyTranscription(ADMIN, 'lemma-1', INPUT, 'r', repo);
    expect(state.scanRefs).toEqual([
      { lemmaId: 'lemma-1', scanPageId: 'page-1', crop: INPUT.crop, userId: 'admin-1' },
    ]);
    expect(state.audits).toHaveLength(1);
    const audit = state.audits[0]!;
    expect(audit.changeType).toBe('transcription_verify');
    const change = audit.change as {
      before: { curatorLocked: boolean; senses: unknown[] };
      after: { curatorLocked: boolean; senses: unknown[] };
      scanPageId: string;
    };
    expect(change.before.curatorLocked).toBe(false);
    expect(change.before.senses).toHaveLength(2);
    expect(change.after.curatorLocked).toBe(true);
    expect(change.after.senses).toHaveLength(2);
    expect(change.scanPageId).toBe('page-1');
  });

  it('defaults glossDefault to the trimmed first sense', async () => {
    const { repo, state } = makeRepo();
    await verifyTranscription(ADMIN, 'lemma-1', INPUT, '', repo);
    expect(state.updates[0]!.glossDefault).toBe('Speaking; utterance.');
  });

  it('rejects senses referencing another lemma\'s translations', async () => {
    const { repo } = makeRepo();
    const bad = { ...INPUT, senses: [{ translationId: 'foreign', body: 'x' }] };
    await expect(verifyTranscription(ADMIN, 'lemma-1', bad, '', repo)).rejects.toThrow(
      CuratorValidationError,
    );
  });

  it('rejects empty sense lists and malformed crops', async () => {
    const { repo } = makeRepo();
    await expect(
      verifyTranscription(ADMIN, 'lemma-1', { ...INPUT, senses: [{ body: '  ' }] }, '', repo),
    ).rejects.toThrow(/at least one sense/);
    await expect(
      verifyTranscription(
        ADMIN,
        'lemma-1',
        { ...INPUT, crop: { x: 0.9, y: 0, w: 0.5, h: 0.1 } },
        '',
        repo,
      ),
    ).rejects.toThrow(/crop/);
  });

  it('rejects lemmas outside every scan-backed dictionary', async () => {
    const { repo } = makeRepo({ lemma: lemma({ sourceId: 'kaikki:or:xyz' }) });
    await expect(verifyTranscription(ADMIN, 'lemma-1', INPUT, '', repo)).rejects.toThrow(
      /not part of a scan-backed dictionary/,
    );
  });
});

describe('configForLemma', () => {
  it('resolves draft and workbench-created prefixes, rejects others', () => {
    expect(configForLemma({ sourceId: 'dsal:praharaj:ଅ:1:0' })?.slug).toBe('dsal-praharaj');
    expect(configForLemma({ sourceId: 'transcribe:molesworth:412:1' })?.slug).toBe('dsal-molesworth');
    expect(configForLemma({ sourceId: 'kaikki:hi:word' })).toBeNull();
    expect(configForLemma({ sourceId: null })).toBeNull();
  });
});

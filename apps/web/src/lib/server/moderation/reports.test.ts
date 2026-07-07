// @vitest-environment node
/**
 * Tests for the translation-report moderation service (T-11.1).
 *
 * Mocks the drizzle `db` surface with a single mutable chain whose return
 * values are staged per-call via `mockReturnValueOnce`. Mirrors the
 * `parse-reports.test.ts` shape — keeps tests scannable without each one
 * having to wire up a fluent builder by hand.
 *
 * `setTranslationHidden` is mocked at the curator module boundary so the
 * tests cover only the moderation-report logic, not the audit + hide
 * machinery (those have their own coverage in `curator.test.ts`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Staged-reads model: each test pushes the rows it expects each
 * awaitable DB call to resolve with, in call order. The chain's `.then`
 * pulls the next staged value, so a call like
 * `await db.select(...).from(...).where(...)` and one like
 * `await db.select(...).from(...).where(...).limit(1)` both consume the
 * same single staged result. Insert/update/delete also resolve via the
 * chain (`.returning()` returns chain, await pulls).
 */
type StagedThrow = { __throw: true; err: unknown };
const staged: Array<unknown | StagedThrow> = [];
function stage(rows: unknown) {
  staged.push(rows);
}
function stageThrow(err: unknown) {
  staged.push({ __throw: true, err });
}
function nextStaged(): unknown {
  if (staged.length === 0) {
    throw new Error(
      'Test bug: a DB call was awaited but no staged result was queued',
    );
  }
  const v = staged.shift();
  if (v && typeof v === 'object' && '__throw' in (v as object)) {
    throw (v as StagedThrow).err;
  }
  return v;
}

type ChainShape = {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  groupBy: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  leftJoin: ReturnType<typeof vi.fn>;
  then: (resolve: (v: unknown) => unknown) => unknown;
};

const chain: ChainShape = {
  from: vi.fn(() => chain),
  where: vi.fn(() => chain),
  limit: vi.fn(() => chain),
  orderBy: vi.fn(() => chain),
  groupBy: vi.fn(() => chain),
  set: vi.fn(() => chain),
  values: vi.fn(() => chain),
  returning: vi.fn(() => chain),
  innerJoin: vi.fn(() => chain),
  leftJoin: vi.fn(() => chain),
  then: (resolve) => resolve(nextStaged()),
};

const fakeDb = {
  select: vi.fn(() => chain),
  insert: vi.fn(() => chain),
  update: vi.fn(() => chain),
  delete: vi.fn(() => chain),
};

vi.mock('../db/index.js', () => ({
  db: fakeDb,
  schema: {
    translations: {
      id: 'tr.id',
      body: 'tr.body',
      hidden: 'tr.hidden',
      targetType: 'tr.target_type',
      targetId: 'tr.target_id',
      source: 'tr.source',
    },
    translationReports: {
      id: 'rep.id',
      translationId: 'rep.translation_id',
      reporterId: 'rep.reporter_id',
      reason: 'rep.reason',
      note: 'rep.note',
      status: 'rep.status',
      resolvedBy: 'rep.resolved_by',
      resolvedAt: 'rep.resolved_at',
      resolutionNote: 'rep.resolution_note',
      createdAt: 'rep.created_at',
      updatedAt: 'rep.updated_at',
    },
    lemmas: {
      id: 'l.id',
      language: 'l.language',
      headword: 'l.headword',
      pos: 'l.pos',
      script: 'l.script',
      glossDefault: 'l.gloss_default',
      frequencyRank: 'l.frequency_rank',
      source: 'l.source',
      sourceAttribution: 'l.source_attribution',
      sourceId: 'l.source_id',
      curatorLocked: 'l.curator_locked',
      createdAt: 'l.created_at',
      updatedAt: 'l.updated_at',
    },
    users: {
      id: 'u.id',
      email: 'u.email',
    },
  },
}));

const setTranslationHiddenMock = vi.fn();
vi.mock('../dictionary/curator.js', async () => {
  const actual = await vi.importActual<
    typeof import('../dictionary/curator.js')
  >('../dictionary/curator.js');
  return {
    ...actual,
    setTranslationHidden: setTranslationHiddenMock,
  };
});

const {
  bulkResolveByTranslation,
  listReporterTranslationIds,
  listReports,
  MAX_REPORTS_PER_DAY,
  publicReport,
  ReportDuplicateError,
  ReportRateLimitError,
  ReportValidationError,
  resolveReport,
  submitReport,
} = await import('./reports.js');

const { ForbiddenError } = await import('../dictionary/permissions.js');
const { MissingReasonError } = await import('../dictionary/audit.js');

const VIEWER_USER = { id: 'user-1', role: 'user' as const };
const VIEWER_CURATOR_HI = {
  id: 'curator-1',
  role: 'curator' as const,
  grantedLanguages: ['hi' as const],
};
const VIEWER_ADMIN = {
  id: 'admin-1',
  role: 'admin' as const,
  grantedLanguages: 'all' as const,
};

const TRANSLATION_USER_HIDDEN_FALSE = {
  id: 'tr-1',
  source: 'user',
  hidden: false,
  lemmaId: 'lemma-1',
  body: 'a body',
};

const LEMMA_HI = {
  id: 'lemma-1',
  language: 'hi',
  headword: 'पानी',
  pos: 'NOUN',
  script: 'Deva',
  glossDefault: null,
  frequencyRank: null,
  source: 'user',
  sourceAttribution: null,
  sourceId: null,
  curatorLocked: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function resetAll() {
  staged.length = 0;
  for (const fn of [
    chain.from,
    chain.where,
    chain.limit,
    chain.orderBy,
    chain.groupBy,
    chain.set,
    chain.values,
    chain.returning,
    chain.innerJoin,
    chain.leftJoin,
  ]) {
    (fn as ReturnType<typeof vi.fn>).mockClear();
  }
  fakeDb.select.mockClear();
  fakeDb.insert.mockClear();
  fakeDb.update.mockClear();
  fakeDb.delete.mockClear();
  setTranslationHiddenMock.mockReset();
}

beforeEach(resetAll);

describe('submitReport — happy path', () => {
  it('inserts a fresh report when the translation exists and is reportable', async () => {
    // 1) loadTranslation: select … limit(1) → [translation]
    stage([TRANSLATION_USER_HIDDEN_FALSE]);
    // 2) assertUnderRateLimit: select count … where (no .limit) — returns awaited array
    //    via the shared `chain.where` resolver. We rebind `where` once.
    stage([{ n: 0 }]);
    // 3) insert(...).values(...).returning() → [inserted]
    const inserted = {
      id: 'rep-1',
      translationId: 'tr-1',
      reporterId: 'user-1',
      reason: 'spam',
      note: null,
      status: 'open',
      resolvedBy: null,
      resolvedAt: null,
      resolutionNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    stage([inserted]);

    const result = await submitReport({ id: 'user-1' }, 'tr-1', {
      reason: 'spam',
    });

    expect(result.id).toBe('rep-1');
    expect(fakeDb.insert).toHaveBeenCalledOnce();
    const args = chain.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.translationId).toBe('tr-1');
    expect(args.reporterId).toBe('user-1');
    expect(args.reason).toBe('spam');
    expect(args.status).toBe('open');
  });

  it('normalizes a whitespace-only note to null', async () => {
    stage([TRANSLATION_USER_HIDDEN_FALSE]);
    stage([{ n: 0 }]);
    stage([
      { id: 'rep-1', translationId: 'tr-1', note: null, reason: 'other', status: 'open' },
    ]);
    await submitReport({ id: 'user-1' }, 'tr-1', { reason: 'other', note: '   ' });
    const args = chain.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.note).toBeNull();
  });
});

describe('submitReport — validation', () => {
  it('rejects an unknown reason without touching the DB', async () => {
    await expect(
      submitReport({ id: 'user-1' }, 'tr-1', { reason: 'libel' as never }),
    ).rejects.toBeInstanceOf(ReportValidationError);
    expect(fakeDb.select).not.toHaveBeenCalled();
  });

  it('rejects a note longer than MAX_NOTE_LEN', async () => {
    await expect(
      submitReport({ id: 'user-1' }, 'tr-1', {
        reason: 'spam',
        note: 'x'.repeat(501),
      }),
    ).rejects.toBeInstanceOf(ReportValidationError);
  });

  it('returns 404 when the translation is missing', async () => {
    stage([]);
    try {
      await submitReport({ id: 'user-1' }, 'tr-missing', { reason: 'spam' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ReportValidationError);
      expect((err as InstanceType<typeof ReportValidationError>).status).toBe(404);
    }
  });

  it('refuses to report an already-hidden translation', async () => {
    stage([
      { ...TRANSLATION_USER_HIDDEN_FALSE, hidden: true },
    ]);
    try {
      await submitReport({ id: 'user-1' }, 'tr-1', { reason: 'spam' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ReportValidationError);
      expect((err as InstanceType<typeof ReportValidationError>).status).toBe(404);
    }
  });

  it('refuses to report an official translation', async () => {
    stage([
      { ...TRANSLATION_USER_HIDDEN_FALSE, source: 'official_dictionary' },
    ]);
    try {
      await submitReport({ id: 'user-1' }, 'tr-1', { reason: 'spam' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ReportValidationError);
      expect((err as InstanceType<typeof ReportValidationError>).status).toBe(409);
    }
  });

  it('refuses to report a private translation (invisible to others)', async () => {
    stage([{ ...TRANSLATION_USER_HIDDEN_FALSE, isPrivate: true }]);
    try {
      await submitReport({ id: 'user-1' }, 'tr-1', { reason: 'spam' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ReportValidationError);
      expect((err as InstanceType<typeof ReportValidationError>).status).toBe(404);
    }
  });
});

describe('submitReport — rate limiting & dedup', () => {
  it('throws ReportRateLimitError once the 24h cap is reached', async () => {
    stage([TRANSLATION_USER_HIDDEN_FALSE]);
    stage([{ n: MAX_REPORTS_PER_DAY }]);
    await expect(
      submitReport({ id: 'user-1' }, 'tr-1', { reason: 'spam' }),
    ).rejects.toBeInstanceOf(ReportRateLimitError);
  });

  it('translates a Postgres unique-violation into ReportDuplicateError', async () => {
    stage([TRANSLATION_USER_HIDDEN_FALSE]);
    stage([{ n: 0 }]);
    const pgErr = Object.assign(new Error('duplicate key'), { code: '23505' });
    stageThrow(pgErr);
    await expect(
      submitReport({ id: 'user-1' }, 'tr-1', { reason: 'spam' }),
    ).rejects.toBeInstanceOf(ReportDuplicateError);
  });
});

describe('listReports', () => {
  it('rejects a plain user', async () => {
    await expect(listReports(VIEWER_USER, {})).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('returns an empty list for a curator with zero grants without hitting the DB', async () => {
    const result = await listReports(
      { id: 'curator-x', role: 'curator', grantedLanguages: [] },
      {},
    );
    expect(result).toEqual([]);
    expect(fakeDb.select).not.toHaveBeenCalled();
  });

  it('lists open reports with a sibling-count subquery', async () => {
    // Main listReports query → resolved at chain.limit
    stage([
      {
        report: {
          id: 'rep-1',
          translationId: 'tr-1',
          reporterId: 'user-1',
          reason: 'spam',
          note: null,
          status: 'open',
          resolvedBy: null,
          resolvedAt: null,
          resolutionNote: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        translation: { id: 'tr-1', body: 'b', hidden: false, lemmaId: 'lemma-1', source: 'user' },
        lemma: { id: 'lemma-1', language: 'hi', headword: 'h', pos: 'NOUN' },
        reporterEmail: 'a@b.test',
      },
    ]);
    // sibling subquery → resolved at chain.groupBy
    stage([{ translationId: 'tr-1', n: 3 }]);

    const result = await listReports(VIEWER_ADMIN, { status: 'open' });
    expect(result).toHaveLength(1);
    expect(result[0]!.siblingReports).toBe(3);
    expect(result[0]!.reporterEmail).toBe('a@b.test');
  });

  it('rejects a curator filtering by an ungranted language', async () => {
    await expect(
      listReports(VIEWER_CURATOR_HI, { language: 'or' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('resolveReport', () => {
  it('rejects a plain user', async () => {
    await expect(
      resolveReport(VIEWER_USER, 'rep-1', 'dismiss'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects an unsupported action', async () => {
    await expect(
      resolveReport(VIEWER_ADMIN, 'rep-1', 'foo' as never),
    ).rejects.toBeInstanceOf(ReportValidationError);
  });

  it('refuses to dismiss an already-resolved report', async () => {
    // loadReport → returns dismissed row
    stage([
      { id: 'rep-1', translationId: 'tr-1', status: 'dismissed' },
    ]);
    try {
      await resolveReport(VIEWER_ADMIN, 'rep-1', 'dismiss');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ReportValidationError);
      expect((err as InstanceType<typeof ReportValidationError>).status).toBe(409);
    }
  });

  it('flips an open report to dismissed for the right viewer scope', async () => {
    // 1) loadReport
    stage([
      { id: 'rep-1', translationId: 'tr-1', status: 'open' },
    ]);
    // 2) loadLemmaForTranslation
    stage([LEMMA_HI]);
    // 3) update returning
    stage([
      {
        id: 'rep-1',
        translationId: 'tr-1',
        status: 'dismissed',
        resolvedBy: 'curator-1',
      },
    ]);

    const result = await resolveReport(
      VIEWER_CURATOR_HI,
      'rep-1',
      'dismiss',
      'not actionable',
    );
    expect(result.status).toBe('dismissed');
    const setArgs = chain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArgs.status).toBe('dismissed');
    expect(setArgs.resolvedBy).toBe('curator-1');
    expect(setArgs.resolutionNote).toBe('not actionable');
  });

  it('rejects a curator without scope on the translation language', async () => {
    stage([
      { id: 'rep-1', translationId: 'tr-1', status: 'open' },
    ]);
    stage([{ ...LEMMA_HI, language: 'or' }]);
    await expect(
      resolveReport(VIEWER_CURATOR_HI, 'rep-1', 'dismiss'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('bulkResolveByTranslation', () => {
  it('rejects an unsupported action', async () => {
    await expect(
      bulkResolveByTranslation(VIEWER_ADMIN, 'tr-1', 'foo' as never),
    ).rejects.toBeInstanceOf(ReportValidationError);
  });

  it('flips reports to resolved_kept without calling setTranslationHidden', async () => {
    // 1) loadTranslation
    stage([TRANSLATION_USER_HIDDEN_FALSE]);
    // 2) loadLemmaForTranslation
    stage([LEMMA_HI]);
    // 3) update returning ids
    stage([{ id: 'rep-1' }, { id: 'rep-2' }]);

    const result = await bulkResolveByTranslation(
      VIEWER_CURATOR_HI,
      'tr-1',
      'resolved_kept',
    );
    expect(result.reportsAffected).toBe(2);
    expect(result.status).toBe('resolved_kept');
    expect(setTranslationHiddenMock).not.toHaveBeenCalled();
  });

  it('calls setTranslationHidden for resolved_hidden + flips reports', async () => {
    stage([TRANSLATION_USER_HIDDEN_FALSE]);
    stage([LEMMA_HI]);
    setTranslationHiddenMock.mockResolvedValueOnce({
      ...TRANSLATION_USER_HIDDEN_FALSE,
      hidden: true,
    });
    stage([{ id: 'rep-1' }]);

    const result = await bulkResolveByTranslation(
      VIEWER_CURATOR_HI,
      'tr-1',
      'resolved_hidden',
      'low quality',
    );

    expect(setTranslationHiddenMock).toHaveBeenCalledWith(
      VIEWER_CURATOR_HI,
      'tr-1',
      true,
      'low quality',
      expect.any(Date),
    );
    expect(result.translation.hidden).toBe(true);
    expect(result.reportsAffected).toBe(1);
  });

  it('requires a reason ≥3 chars when hiding', async () => {
    stage([TRANSLATION_USER_HIDDEN_FALSE]);
    stage([LEMMA_HI]);
    await expect(
      bulkResolveByTranslation(VIEWER_CURATOR_HI, 'tr-1', 'resolved_hidden', 'hi'),
    ).rejects.toBeInstanceOf(MissingReasonError);
    expect(setTranslationHiddenMock).not.toHaveBeenCalled();
  });

  it('rejects a curator without scope on the translation language', async () => {
    stage([TRANSLATION_USER_HIDDEN_FALSE]);
    stage([{ ...LEMMA_HI, language: 'or' }]);
    await expect(
      bulkResolveByTranslation(VIEWER_CURATOR_HI, 'tr-1', 'resolved_kept'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects a plain user before any DB hit', async () => {
    await expect(
      bulkResolveByTranslation(VIEWER_USER, 'tr-1', 'resolved_kept'),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(fakeDb.select).not.toHaveBeenCalled();
  });

  it('translates a CuratorValidationError into ReportValidationError', async () => {
    stage([TRANSLATION_USER_HIDDEN_FALSE]);
    stage([LEMMA_HI]);
    const { CuratorValidationError } = await import('../dictionary/curator.js');
    setTranslationHiddenMock.mockRejectedValueOnce(
      new CuratorValidationError('Only community translations can be hidden', 409),
    );
    try {
      await bulkResolveByTranslation(
        VIEWER_CURATOR_HI,
        'tr-1',
        'resolved_hidden',
        'low quality',
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ReportValidationError);
      expect((err as InstanceType<typeof ReportValidationError>).status).toBe(409);
    }
  });
});

describe('listReporterTranslationIds', () => {
  it('returns an empty Set when given no translation ids without touching the DB', async () => {
    const set = await listReporterTranslationIds('user-1', []);
    expect(set.size).toBe(0);
    expect(fakeDb.select).not.toHaveBeenCalled();
  });

  it('returns the subset the reporter has previously reported', async () => {
    stage([
      { translationId: 'tr-1' },
      { translationId: 'tr-3' },
    ]);
    const set = await listReporterTranslationIds('user-1', ['tr-1', 'tr-2', 'tr-3']);
    expect([...set].sort()).toEqual(['tr-1', 'tr-3']);
  });
});

describe('publicReport', () => {
  it('strips reporterId and serializes createdAt as ISO', () => {
    const row = {
      id: 'rep-1',
      translationId: 'tr-1',
      reporterId: 'user-1',
      reason: 'spam' as const,
      note: null,
      status: 'open' as const,
      resolvedBy: null,
      resolvedAt: null,
      resolutionNote: null,
      createdAt: new Date('2026-04-29T12:00:00Z'),
      updatedAt: new Date('2026-04-29T12:00:00Z'),
    };
    const dto = publicReport(row);
    expect(dto).toEqual({
      id: 'rep-1',
      translationId: 'tr-1',
      reason: 'spam',
      note: null,
      status: 'open',
      createdAt: '2026-04-29T12:00:00.000Z',
    });
    expect('reporterId' in dto).toBe(false);
  });
});

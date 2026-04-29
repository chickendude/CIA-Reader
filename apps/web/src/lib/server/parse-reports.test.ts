// @vitest-environment node
/**
 * Tests for the parse_reports service (T-6.5).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows: Array<Record<string, unknown>> = [];
type ChainShape = {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  offset: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
  $dynamic: ReturnType<typeof vi.fn>;
};
const chain: ChainShape = {
  from: vi.fn(() => chain),
  where: vi.fn(() => chain),
  limit: vi.fn(() => chain),
  offset: vi.fn(() => rows),
  orderBy: vi.fn(() => chain),
  set: vi.fn(() => chain),
  values: vi.fn(() => chain),
  returning: vi.fn(() => rows),
  $dynamic: vi.fn(() => chain),
};
const fakeDb = {
  select: vi.fn(() => chain),
  insert: vi.fn(() => chain),
  update: vi.fn(() => chain),
};

vi.mock('./db/index.js', () => ({
  db: fakeDb,
  schema: {
    parseReports: {
      id: 'pr.id',
      language: 'pr.language',
      surfaceNfc: 'pr.surface_nfc',
      contextSignature: 'pr.context_signature',
      correctedLemmaId: 'pr.corrected_lemma_id',
      correctionType: 'pr.correction_type',
      status: 'pr.status',
      duplicateCount: 'pr.duplicate_count',
      updatedAt: 'pr.updated_at',
    },
  },
}));

const { fileParseReport, listParseReports } = await import('./parse-reports.js');

function resetAll() {
  rows.length = 0;
  for (const fn of Object.values(chain))
    (fn as ReturnType<typeof vi.fn>).mockClear();
  fakeDb.select.mockClear();
  fakeDb.insert.mockClear();
  fakeDb.update.mockClear();
}

beforeEach(resetAll);

const baseInput = {
  reporterId: 'u1',
  tokenId: 'tok-1',
  language: 'hi' as const,
  surfaceNfc: 'पाठ',
  contextSignature: 'sig',
  originalCandidates: [],
  correctedLemmaId: 'lem-2',
  correctionType: 'manual_lemma' as const,
  note: 'wrong parse',
};

describe('fileParseReport', () => {
  it('creates a fresh report when no open match exists', async () => {
    chain.limit.mockReturnValueOnce([]); // dedup lookup → none
    chain.returning.mockReturnValueOnce([
      { id: 'pr-1', duplicateCount: 1, status: 'open' },
    ]);
    const r = await fileParseReport(baseInput);
    expect(r.merged).toBe(false);
    expect(r.report.id).toBe('pr-1');
    expect(fakeDb.insert).toHaveBeenCalledOnce();
    expect(fakeDb.update).not.toHaveBeenCalled();
  });

  it('increments duplicate_count when an open report matches the dedup tuple', async () => {
    chain.limit.mockReturnValueOnce([
      { id: 'pr-existing', duplicateCount: 3, status: 'open' },
    ]);
    chain.returning.mockReturnValueOnce([
      { id: 'pr-existing', duplicateCount: 4, status: 'open' },
    ]);
    const r = await fileParseReport(baseInput);
    expect(r.merged).toBe(true);
    expect(r.report.duplicateCount).toBe(4);
    expect(fakeDb.update).toHaveBeenCalledOnce();
    expect(fakeDb.insert).not.toHaveBeenCalled();
    const setArg = chain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg.duplicateCount).toBe(4);
  });

  it('honors initialStatus when provided (T-6.7 system reports land triaged)', async () => {
    chain.limit.mockReturnValueOnce([]);
    chain.returning.mockReturnValueOnce([{ id: 'pr-1', status: 'triaged' }]);
    await fileParseReport({ ...baseInput, initialStatus: 'triaged' });
    const args = chain.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.status).toBe('triaged');
  });

  it('passes through originalCandidates + correctionType verbatim', async () => {
    chain.limit.mockReturnValueOnce([]);
    chain.returning.mockReturnValueOnce([{ id: 'pr-1' }]);
    const cands: Array<{
      lemmaId: string | null;
      score: number;
      features: Record<string, string>;
    }> = [
      { lemmaId: 'a', score: 0.5, features: { Case: 'Nom' } },
      { lemmaId: null, score: 0.2, features: {} },
    ];
    await fileParseReport({
      ...baseInput,
      originalCandidates: cands,
      correctionType: 'new_lemma',
    });
    const args = chain.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.originalCandidates).toEqual(cands);
    expect(args.correctionType).toBe('new_lemma');
  });
});

describe('listParseReports', () => {
  it('runs an unfiltered list against the table when filter is empty', async () => {
    chain.offset.mockReturnValueOnce([{ id: 'pr-1' }, { id: 'pr-2' }]);
    const list = await listParseReports({});
    expect(list).toHaveLength(2);
    // No filter ⇒ no WHERE clause is appended.
    expect(chain.where).not.toHaveBeenCalled();
  });

  it('passes through language + status + correctionType filters', async () => {
    chain.offset.mockReturnValueOnce([{ id: 'pr-1' }]);
    await listParseReports({
      language: 'hi',
      status: 'open',
      correctionType: 'manual_lemma',
    });
    // Single composite WHERE call carries all three filters.
    expect(chain.where).toHaveBeenCalledOnce();
  });
});

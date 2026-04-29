// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fileParseReport = vi.fn();

const groupedRows: Array<Record<string, unknown>> = [];
type ChainShape = {
  values: ReturnType<typeof vi.fn>;
  onConflictDoUpdate: ReturnType<typeof vi.fn>;
};
const chain: ChainShape = {
  values: vi.fn(() => chain),
  onConflictDoUpdate: vi.fn(() => Promise.resolve(undefined)),
};

const fakeDb = {
  execute: vi.fn(async () => groupedRows),
  insert: vi.fn(() => chain),
};

vi.mock('./db/index.js', () => ({
  db: fakeDb,
  schema: {
    formLemmaOverrides: {
      language: 'flo.language',
      surfaceNfc: 'flo.surface_nfc',
      contextSignature: 'flo.context_signature',
    },
  },
}));

vi.mock('./parse-reports.js', () => ({
  fileParseReport: (...a: unknown[]) => fileParseReport(...a),
}));

const { runCorrectionAggregation } = await import('./correction-aggregation.js');

beforeEach(() => {
  groupedRows.length = 0;
  for (const fn of Object.values(chain))
    (fn as ReturnType<typeof vi.fn>).mockClear();
  fakeDb.execute.mockClear();
  fakeDb.insert.mockClear();
  fileParseReport.mockReset();
  fileParseReport.mockResolvedValue({ report: { id: 'pr' }, merged: false });
});

describe('runCorrectionAggregation', () => {
  it('promotes a group that meets both thresholds', async () => {
    groupedRows.push({
      language: 'hi',
      surfaceNfc: 'है',
      contextSignature: '',
      chosenLemmaId: 'lem-honaa',
      distinctUsers: 8,
      totalDistinctUsers: 10,
      voteCount: 8,
    });
    const r = await runCorrectionAggregation();
    expect(r.qualifyingGroups).toBe(1);
    expect(r.overridesUpserted).toBe(1);
    expect(r.reportsFiled).toBe(1);
    expect(fileParseReport).toHaveBeenCalledWith(
      expect.objectContaining({ initialStatus: 'triaged' }),
    );
  });

  it('skips a group with too few distinct users', async () => {
    groupedRows.push({
      language: 'hi',
      surfaceNfc: 'का',
      contextSignature: '',
      chosenLemmaId: 'lem-x',
      distinctUsers: 3,
      totalDistinctUsers: 3,
      voteCount: 3,
    });
    const r = await runCorrectionAggregation();
    expect(r.qualifyingGroups).toBe(0);
    expect(fakeDb.insert).not.toHaveBeenCalled();
  });

  it('skips a group below the majority threshold', async () => {
    groupedRows.push({
      language: 'hi',
      surfaceNfc: 'X',
      contextSignature: '',
      chosenLemmaId: 'lem-a',
      distinctUsers: 6,
      totalDistinctUsers: 12,
      voteCount: 6,
    });
    const r = await runCorrectionAggregation();
    // 6/12 = 50% — under the 70% default.
    expect(r.qualifyingGroups).toBe(0);
  });

  it('skips groups with chosen_lemma_id=null', async () => {
    groupedRows.push({
      language: 'hi',
      surfaceNfc: 'X',
      contextSignature: '',
      chosenLemmaId: null,
      distinctUsers: 100,
      totalDistinctUsers: 100,
      voteCount: 100,
    });
    const r = await runCorrectionAggregation();
    expect(r.qualifyingGroups).toBe(0);
  });

  it('honors custom thresholds', async () => {
    groupedRows.push({
      language: 'hi',
      surfaceNfc: 'मैं',
      contextSignature: '',
      chosenLemmaId: 'lem-y',
      distinctUsers: 3,
      totalDistinctUsers: 3,
      voteCount: 3,
    });
    const r = await runCorrectionAggregation({
      minDistinctUsers: 2,
      minMajority: 0.5,
    });
    expect(r.qualifyingGroups).toBe(1);
  });
});

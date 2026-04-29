// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fileParseReport = vi.fn();

const rows: Array<Record<string, unknown>> = [];
type ChainShape = {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  onConflictDoUpdate: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
};
const chain: ChainShape = {
  from: vi.fn(() => chain),
  where: vi.fn(() => chain),
  limit: vi.fn(() => rows),
  values: vi.fn(() => chain),
  onConflictDoUpdate: vi.fn(() => chain),
  returning: vi.fn(() => rows),
};
const fakeDb = {
  select: vi.fn(() => chain),
  insert: vi.fn(() => chain),
};

vi.mock('./db/index.js', () => ({
  db: fakeDb,
  schema: {
    textTokens: { id: 'tt.id' },
    tokenCorrections: { userId: 'tc.user_id', tokenId: 'tc.token_id' },
    lemmaProposals: { id: 'lp.id' },
  },
}));

vi.mock('./parse-reports.js', () => ({
  fileParseReport: (...a: unknown[]) => fileParseReport(...a),
}));

const { submitLemmaProposal, LemmaProposalValidationError } = await import(
  './lemma-proposals.js'
);

function resetAll() {
  rows.length = 0;
  for (const fn of Object.values(chain))
    (fn as ReturnType<typeof vi.fn>).mockClear();
  fakeDb.select.mockClear();
  fakeDb.insert.mockClear();
  fileParseReport.mockReset();
  fileParseReport.mockResolvedValue({ report: { id: 'pr-1' }, merged: false });
}

beforeEach(resetAll);

const baseInput = {
  proposerId: 'u1',
  tokenId: 'tok-1',
  language: 'hi' as const,
  headword: ' पाठ ',
  pos: 'NOUN',
  glossDefault: ' a lesson ',
  surfaceNfc: 'पाठ',
  originalCandidates: [],
};

describe('submitLemmaProposal', () => {
  it('writes proposal + correction + parse_report on a happy path', async () => {
    chain.limit.mockReturnValueOnce([{ id: 'tok-1' }]); // token lookup
    chain.returning.mockReturnValueOnce([
      {
        id: 'prop-1',
        headword: 'पाठ',
        pos: 'NOUN',
        glossDefault: 'a lesson',
        status: 'pending',
      },
    ]); // lemma_proposals insert
    chain.returning.mockReturnValueOnce([
      {
        userId: 'u1',
        tokenId: 'tok-1',
        type: 'new_lemma',
        chosenLemmaId: null,
        note: 'proposal:prop-1',
      },
    ]); // token_corrections upsert

    const r = await submitLemmaProposal(baseInput);
    expect(r.proposal.id).toBe('prop-1');
    expect(r.correction.type).toBe('new_lemma');
    expect(fakeDb.insert).toHaveBeenCalledTimes(2);
    expect(fileParseReport).toHaveBeenCalledOnce();
    const args = fileParseReport.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.correctionType).toBe('new_lemma');
    expect(args.correctedLemmaId).toBeNull();

    // Headword + gloss were trimmed.
    const proposalArgs = chain.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(proposalArgs.headword).toBe('पाठ');
    expect(proposalArgs.glossDefault).toBe('a lesson');
  });

  it('rejects an empty headword with 400', async () => {
    await expect(
      submitLemmaProposal({ ...baseInput, headword: '   ' }),
    ).rejects.toBeInstanceOf(LemmaProposalValidationError);
  });

  it('rejects an empty POS with 400', async () => {
    await expect(
      submitLemmaProposal({ ...baseInput, pos: '' }),
    ).rejects.toBeInstanceOf(LemmaProposalValidationError);
  });

  it('returns 404 when the token does not exist', async () => {
    chain.limit.mockReturnValueOnce([]); // token lookup → none
    await expect(submitLemmaProposal(baseInput)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('passes notes through unchanged', async () => {
    chain.limit.mockReturnValueOnce([{ id: 'tok-1' }]);
    chain.returning.mockReturnValueOnce([{ id: 'prop-2' }]);
    chain.returning.mockReturnValueOnce([{ userId: 'u1' }]);
    await submitLemmaProposal({
      ...baseInput,
      notes: 'plural-only form',
    });
    const proposalArgs = chain.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(proposalArgs.notes).toBe('plural-only form');
  });
});

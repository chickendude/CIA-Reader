// @vitest-environment node
/**
 * Unit test for `regenerateAllForParadigm` (curator-paradigm
 * follow-up). The function loops over every lemma opted into a
 * paradigm and runs the existing `regenerateForms` per lemma; this
 * suite verifies the aggregation + per-lemma error containment.
 *
 * Same-module bindings make it awkward to mock `regenerateForms`
 * via `vi.spyOn`, so the function accepts injected collaborators
 * (`lookupLemmas`, `regenerateLemma`) for testing. Production callers
 * leave the defaults in place.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { regenerateAllForParadigm } from './lemma-forms.js';

const lookupLemmas = vi.fn();
const regenerateLemma = vi.fn();

beforeEach(() => {
  lookupLemmas.mockReset();
  regenerateLemma.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('regenerateAllForParadigm', () => {
  it('returns a zero summary when no lemma opts into the paradigm', async () => {
    lookupLemmas.mockResolvedValueOnce([]);
    const out = await regenerateAllForParadigm('p-1', {
      lookupLemmas,
      regenerateLemma,
    });
    expect(out).toEqual({
      lemmasProcessed: 0,
      lemmasFailed: 0,
      removed: 0,
      inserted: 0,
      failures: [],
    });
    expect(regenerateLemma).not.toHaveBeenCalled();
  });

  it('walks every lemma and aggregates removed + inserted counts', async () => {
    lookupLemmas.mockResolvedValueOnce([
      { id: 'l-1', headword: 'a', pos: 'VERB', language: 'hi', stem: 'a' },
      { id: 'l-2', headword: 'b', pos: 'VERB', language: 'hi', stem: 'b' },
      { id: 'l-3', headword: 'c', pos: 'VERB', language: 'hi', stem: 'c' },
    ]);
    regenerateLemma
      .mockResolvedValueOnce({ removed: 5, inserted: 6 })
      .mockResolvedValueOnce({ removed: 7, inserted: 8 })
      .mockResolvedValueOnce({ removed: 1, inserted: 1 });
    const out = await regenerateAllForParadigm('p-1', {
      lookupLemmas,
      regenerateLemma,
    });
    expect(out.lemmasProcessed).toBe(3);
    expect(out.lemmasFailed).toBe(0);
    expect(out.removed).toBe(13);
    expect(out.inserted).toBe(15);
    expect(out.failures).toEqual([]);
    expect(regenerateLemma).toHaveBeenCalledTimes(3);
  });

  it('keeps going when one lemma fails and records the failure', async () => {
    lookupLemmas.mockResolvedValueOnce([
      { id: 'l-1', headword: 'good', pos: 'VERB', language: 'hi', stem: 's' },
      { id: 'l-2', headword: 'बोलना', pos: 'VERB', language: 'hi', stem: 's' },
    ]);
    regenerateLemma
      .mockResolvedValueOnce({ removed: 4, inserted: 4 })
      .mockRejectedValueOnce(new Error('nlp down'));
    const out = await regenerateAllForParadigm('p-1', {
      lookupLemmas,
      regenerateLemma,
    });
    expect(out.lemmasProcessed).toBe(1);
    expect(out.lemmasFailed).toBe(1);
    expect(out.removed).toBe(4);
    expect(out.inserted).toBe(4);
    expect(out.failures).toEqual([
      { lemmaId: 'l-2', headword: 'बोलना', error: 'nlp down' },
    ]);
  });

  it('coerces non-Error throws into a string error message', async () => {
    lookupLemmas.mockResolvedValueOnce([
      { id: 'l-1', headword: 'h', pos: 'VERB', language: 'hi', stem: 's' },
    ]);
    regenerateLemma.mockRejectedValueOnce('weird-string-throw');
    const out = await regenerateAllForParadigm('p-1', {
      lookupLemmas,
      regenerateLemma,
    });
    expect(out.failures[0]!.error).toBe('weird-string-throw');
  });
});

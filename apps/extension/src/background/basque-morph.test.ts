import { describe, expect, it } from 'vitest';

import { basqueStemCandidates } from './basque-morph';

describe('basqueStemCandidates', () => {
  it('exposes the noun stem behind an allative ending', () => {
    // "baratzera" (to the garden) = baratze + -ra
    expect(basqueStemCandidates('baratzera')).toContain('baratze');
  });

  it('exposes the stem behind the singular article', () => {
    expect(basqueStemCandidates('etxea')).toContain('etxe'); // etxe + -a
  });

  it('exposes the stem behind the inessive', () => {
    expect(basqueStemCandidates('mendian')).toContain('mendi'); // mendi + -an
  });

  it('never returns the surface itself', () => {
    expect(basqueStemCandidates('baratzera')).not.toContain('baratzera');
  });

  it('ignores tokens that are not plain letters', () => {
    expect(basqueStemCandidates('123')).toEqual([]);
    expect(basqueStemCandidates('')).toEqual([]);
  });
});

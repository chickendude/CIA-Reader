import { describe, expect, it } from 'vitest';
import { COVERS, coverForId } from './cover.js';

describe('coverForId', () => {
  it('returns one of the seven design covers', () => {
    expect(COVERS).toContain(coverForId('a'));
    expect(COVERS).toContain(coverForId('a-very-long-uuid-style-text-id'));
  });

  it('is deterministic — the same id always picks the same cover', () => {
    expect(coverForId('idgah')).toBe(coverForId('idgah'));
    expect(coverForId('godaan')).toBe(coverForId('godaan'));
  });

  it('spreads across multiple covers (not all ids land on the same one)', () => {
    const seen = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(coverForId),
    );
    // 10 ids should land on at least 3 different covers — anything
    // less suggests the hash is collapsing badly.
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });
});

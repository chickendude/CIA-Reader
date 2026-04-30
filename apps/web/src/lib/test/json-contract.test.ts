// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { jsonContract } from './json-contract.js';

describe('jsonContract', () => {
  it('produces stable sorted structural signatures', () => {
    expect(
      jsonContract({
        z: [{ n: 1, ok: true }],
        a: null,
      }),
    ).toEqual({
      a: 'null',
      z: [{ n: 'number', ok: 'boolean' }],
    });
  });

  it('marks empty arrays without inventing an item shape', () => {
    expect(jsonContract({ items: [] })).toEqual({ items: 'array' });
  });
});

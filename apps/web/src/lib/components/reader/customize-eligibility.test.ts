import { describe, expect, it } from 'vitest';

import { customizableOfficialIds } from './customize-eligibility.js';

describe('customizableOfficialIds (T-3.11)', () => {
  const officials = [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }];

  it('returns the empty set when the viewer is not the owner', () => {
    const result = customizableOfficialIds(false, officials, []);
    expect(result.size).toBe(0);
  });

  it('returns every official when the personal bucket is empty', () => {
    const result = customizableOfficialIds(true, officials, []);
    expect([...result].sort()).toEqual(['o1', 'o2', 'o3']);
  });

  it('excludes officials that the viewer has already forked', () => {
    const personal = [{ parentTranslationId: 'o2' }];
    const result = customizableOfficialIds(true, officials, personal);
    expect([...result].sort()).toEqual(['o1', 'o3']);
  });

  it('ignores personal translations with no parent (fresh community submissions)', () => {
    const personal = [
      { parentTranslationId: null },
      { parentTranslationId: 'o1' },
    ];
    const result = customizableOfficialIds(true, officials, personal);
    expect([...result].sort()).toEqual(['o2', 'o3']);
  });

  it('handles parents pointing at an unknown official without breaking', () => {
    // Could happen if a curator soft-hid the official the user previously
    // forked — the fork's parent_translation_id still points at the now-
    // invisible row. We just do the straightforward set-difference and
    // return only officials currently visible.
    const personal = [{ parentTranslationId: 'o-deleted' }];
    const result = customizableOfficialIds(true, officials, personal);
    expect([...result].sort()).toEqual(['o1', 'o2', 'o3']);
  });

  it('returns a fresh Set on every call (not a shared reference)', () => {
    const a = customizableOfficialIds(true, officials, []);
    const b = customizableOfficialIds(true, officials, []);
    expect(a).not.toBe(b);
    a.delete('o1');
    expect(b.has('o1')).toBe(true);
  });
});

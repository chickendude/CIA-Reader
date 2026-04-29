import { describe, expect, it, vi } from 'vitest';

// canReadText consults three sharing modules via dynamic imports:
// T-7.2 direct shares, T-7.4 group shares, T-8.4 collection shares.
// Mock all three to "no share" so this unit test stays focused on
// visibility / owner branches without hitting the DB.
vi.mock('../texts/sharing.js', () => ({
  viewerHasDirectShare: async () => false,
}));
vi.mock('../groups.js', () => ({
  viewerHasGroupShare: async () => false,
}));
vi.mock('../collections.js', () => ({
  viewerHasCollectionShareForText: async () => false,
}));

import { ForbiddenError } from '../dictionary/permissions.js';
import { assertCanReadText, canReadText } from './can-read.js';

const VIEWER = { id: 'viewer-1' };
const OTHER = { id: 'someone-else' };

function text(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    ownerId: VIEWER.id,
    visibility: 'private' as const,
    ...overrides,
  };
}

describe('canReadText', () => {
  it('allows the owner of a private text', async () => {
    expect(await canReadText(VIEWER, text())).toBe(true);
  });

  it('denies a non-owner of a private text', async () => {
    expect(await canReadText(OTHER, text())).toBe(false);
  });

  it('denies anonymous viewers of a private text', async () => {
    expect(await canReadText(null, text())).toBe(false);
  });

  it('allows anyone (including anonymous) to read official texts', async () => {
    expect(await canReadText(null, text({ visibility: 'official' }))).toBe(true);
    expect(await canReadText(OTHER, text({ visibility: 'official' }))).toBe(true);
  });

  it('denies non-owners of texts with visibility=shared (M7 not yet wired)', async () => {
    // The shared-visibility row exists but the text_shares lookup
    // hasn't been implemented yet — until M7 lands, deny-by-default.
    expect(await canReadText(OTHER, text({ visibility: 'shared' }))).toBe(false);
  });

  it('still allows the owner of a shared-visibility text (sharing to self is meaningless but the owner path wins)', async () => {
    expect(
      await canReadText(VIEWER, text({ visibility: 'shared', ownerId: VIEWER.id })),
    ).toBe(true);
  });
});

describe('assertCanReadText', () => {
  it('returns void on allow', async () => {
    await expect(assertCanReadText(VIEWER, text())).resolves.toBeUndefined();
  });

  it('throws ForbiddenError on deny', async () => {
    await expect(assertCanReadText(OTHER, text())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

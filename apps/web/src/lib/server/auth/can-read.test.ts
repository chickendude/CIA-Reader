import { describe, expect, it, vi } from 'vitest';
const staff = vi.hoisted(() => vi.fn().mockResolvedValue(false));
vi.mock('./staff.js', () => ({ isStaffMember: staff }));

// Assume there are no direct, group or collection shares unless the test sets one up.
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
  it('requires staff even for the owner of a restricted official book', async () => {
    const restricted = text({ visibility: 'official', staffOnly: true });
    expect(await canReadText(null, restricted)).toBe(false);
    expect(await canReadText(VIEWER, restricted)).toBe(false);
    staff.mockResolvedValueOnce(true);
    expect(await canReadText(OTHER, restricted)).toBe(true);
    expect(await canReadText(VIEWER, text({ staffOnly: true }))).toBe(false);
  });
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

  it('denies access to a shared text when the viewer has no matching share', async () => {
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

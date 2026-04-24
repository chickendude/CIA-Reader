// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ChainShape = {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  onConflictDoUpdate: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
};

const chain: ChainShape = {
  from: vi.fn(() => chain),
  where: vi.fn(() => chain),
  values: vi.fn(() => chain),
  set: vi.fn(() => chain),
  onConflictDoUpdate: vi.fn(() => chain),
  returning: vi.fn(() => [] as unknown[]),
};

const fakeDb = {
  insert: vi.fn(() => chain),
  update: vi.fn(() => chain),
};

vi.mock('./db/index.js', () => ({
  db: fakeDb,
  schema: {
    users: { id: 'users.id' },
    userLanguages: { userId: 'user_id', language: 'language' },
  },
}));

const { completeOnboarding, shouldRedirectToOnboarding } = await import('./onboarding.js');

beforeEach(() => {
  (Object.values(chain) as Array<ReturnType<typeof vi.fn>>).forEach((fn) => fn.mockClear());
  fakeDb.insert.mockClear();
  fakeDb.update.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('shouldRedirectToOnboarding', () => {
  const needsOnboarding = { onboardedAt: null };
  const onboarded = { onboardedAt: new Date('2026-01-01') };

  it('redirects a signed-in, never-onboarded user away from a normal page', () => {
    expect(shouldRedirectToOnboarding(needsOnboarding, '/')).toBe(true);
    expect(shouldRedirectToOnboarding(needsOnboarding, '/profile')).toBe(true);
  });

  it('does not loop on the onboarding page itself', () => {
    expect(shouldRedirectToOnboarding(needsOnboarding, '/onboarding')).toBe(false);
    expect(shouldRedirectToOnboarding(needsOnboarding, '/onboarding/step2')).toBe(false);
  });

  it('does not redirect API traffic (mobile / JSON clients handle onboarding their own way)', () => {
    expect(shouldRedirectToOnboarding(needsOnboarding, '/api/v1/me/profile')).toBe(false);
  });

  it('does not redirect auth-flow pages (login, register, logout)', () => {
    expect(shouldRedirectToOnboarding(needsOnboarding, '/login')).toBe(false);
    expect(shouldRedirectToOnboarding(needsOnboarding, '/register')).toBe(false);
    expect(shouldRedirectToOnboarding(needsOnboarding, '/logout')).toBe(false);
  });

  it('does nothing when the user is already onboarded', () => {
    expect(shouldRedirectToOnboarding(onboarded, '/')).toBe(false);
  });

  it('does nothing for anonymous visitors', () => {
    expect(shouldRedirectToOnboarding(null, '/')).toBe(false);
  });
});

describe('completeOnboarding', () => {
  it('upserts a user_languages row and stamps users.onboardedAt', async () => {
    // First call (insert...returning) → language row; second (update...returning) → user row.
    chain.returning
      .mockReturnValueOnce([{ userId: 'u1', language: 'hi', baseline: 'beginner' }])
      .mockReturnValueOnce([{ id: 'u1', onboardedAt: new Date(), email: 'a@b.c' }]);
    const result = await completeOnboarding('u1', 'hi', 'beginner');
    expect(fakeDb.insert).toHaveBeenCalledTimes(1);
    expect(fakeDb.update).toHaveBeenCalledTimes(1);
    expect(chain.values).toHaveBeenCalledWith({
      userId: 'u1',
      language: 'hi',
      baseline: 'beginner',
    });
    expect(chain.onConflictDoUpdate).toHaveBeenCalled();
    expect(result.language.baseline).toBe('beginner');
    expect(result.user.onboardedAt).toBeInstanceOf(Date);
  });

  it('throws when the user row cannot be updated (e.g. deleted mid-flight)', async () => {
    chain.returning
      .mockReturnValueOnce([{ userId: 'u1', language: 'or', baseline: 'none' }])
      .mockReturnValueOnce([]);
    await expect(completeOnboarding('u1', 'or', 'none')).rejects.toThrow('user not found');
  });
});

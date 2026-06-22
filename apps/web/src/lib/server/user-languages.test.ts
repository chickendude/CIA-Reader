// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture the drizzle insert chain so we can assert the upsert shape
// without a real database. vi.hoisted lets the mock factory reference the
// spies directly (no forwarding wrapper, so no unused-arg lint noise).
const { insert, values, onConflictDoUpdate } = vi.hoisted(() => {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));
  return { insert, values, onConflictDoUpdate };
});

vi.mock('./db/index.js', () => ({
  db: { insert },
  schema: {
    userLanguages: {
      userId: 'user_id',
      language: 'language',
    },
  },
}));

beforeEach(() => {
  insert.mockClear();
  values.mockClear();
  onConflictDoUpdate.mockClear();
});

afterEach(() => vi.resetModules());

describe('addUserLanguage', () => {
  it('upserts a row carrying the chosen baseline', async () => {
    const { addUserLanguage } = await import('./user-languages.js');
    await addUserLanguage('u1', 'mr', 'beginner');

    expect(values).toHaveBeenCalledWith({
      userId: 'u1',
      language: 'mr',
      baseline: 'beginner',
    });
    // Conflict branch re-applies the baseline (+ bumps updatedAt).
    const conflictArg = onConflictDoUpdate.mock.calls[0]![0] as {
      set: { baseline: string };
    };
    expect(conflictArg.set.baseline).toBe('beginner');
  });

  it("defaults the baseline to 'none'", async () => {
    const { addUserLanguage } = await import('./user-languages.js');
    await addUserLanguage('u1', 'or');
    expect(values).toHaveBeenCalledWith({
      userId: 'u1',
      language: 'or',
      baseline: 'none',
    });
  });
});
